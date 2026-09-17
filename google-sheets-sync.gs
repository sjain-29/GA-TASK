/*  Project Task Tracker — Google Sheets ⇄ Firebase sync
    ============================================================
    Paste this whole file into Extensions → Apps Script (in your
    Google Sheet), then follow "Setup" in the README.

    What this does:
    - PULL (Firebase → Sheet): rewrites the "Task Log" and "Projects"
      tabs from the live database. Runs automatically every few
      minutes on a time trigger, so changes made in the app show up
      here without you doing anything.
    - PUSH (Sheet → Firebase): when you edit a cell by hand, that one
      change is sent straight back to the matching task/project.
      This is instant (it fires on edit), but only the cell you
      touched is sent — it will not detect you inserting whole new
      rows (add those from the app instead, then let PULL bring them
      into the sheet).

    Nothing here stores your password in the file itself — it's kept
    in this project's Script Properties, which only you can see.
    ============================================================ */

const STAGES = ["L1","TEC","Awarded","Procurement","Inventory","Production","QC",
  "Testing","Dispatch","Delivered","Payment","Documentation","Failed"];

const TASK_FIELD = { // sheet header -> Firebase field name
  "Date Logged":"logged","Vertical":"vertical","Task Description":"task",
  "Client / Customer":"client","Order Type":"orderType","Priority":"priority",
  "Due Date":"due","Execution / Event Date":"event","Event Type":"eventType",
  "Status":"status","Completed Date":"completed","Remarks":"remarks"
};
const PROJECT_FIELD = {
  "Project Name":"name","Requirements":"requirements","Start Date":"start","End Date":"end"
};

const TASK_HEADERS = ["Key","User","Task ID","Date Logged","Vertical","Task Description",
  "Client / Customer","Order Type","Priority","Due Date","Execution / Event Date",
  "Event Type","Status","Completed Date","Remarks"];
const PROJECT_HEADERS = ["Key","User","Project ID","Project Name","Requirements","Start Date","End Date"]
  .concat(STAGES).concat(["% Complete","Overall Status"]);

/* ---------------- auth ---------------- */
function getIdToken_(){
  const p = PropertiesService.getScriptProperties();
  const apiKey = p.getProperty("FIREBASE_API_KEY");
  const email = p.getProperty("FIREBASE_EMAIL");
  const pass = p.getProperty("FIREBASE_PASSWORD");
  if(!apiKey||!email||!pass) throw new Error("Set FIREBASE_API_KEY, FIREBASE_EMAIL, FIREBASE_PASSWORD in Script Properties first.");
  const res = UrlFetchApp.fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key="+apiKey,
    {method:"post",contentType:"application/json",
     payload:JSON.stringify({email:email,password:pass,returnSecureToken:true}),
     muteHttpExceptions:true});
  const body = JSON.parse(res.getContentText());
  if(!body.idToken) throw new Error("Firebase sign-in failed: "+(body.error&&body.error.message));
  return body.idToken;
}
function dbUrl_(){
  const u = PropertiesService.getScriptProperties().getProperty("FIREBASE_DB_URL");
  if(!u) throw new Error("Set FIREBASE_DB_URL in Script Properties first.");
  return u.replace(/\/$/,"");
}

/* ---------------- PULL: Firebase -> Sheet ---------------- */
function pullFromFirebase(){
  const token = getIdToken_();
  const res = UrlFetchApp.fetch(dbUrl_()+"/users.json?auth="+token, {muteHttpExceptions:true});
  const users = JSON.parse(res.getContentText()) || {};
  writeTaskSheet_(users);
  writeProjectSheet_(users);
}

function writeTaskSheet_(users){
  const ss=SpreadsheetApp.getActive();
  const sh=ss.getSheetByName("Task Log")||ss.insertSheet("Task Log");
  const rows=[TASK_HEADERS];
  Object.keys(users).forEach(uid=>{
    const u=users[uid]||{}; const uname=(u.profile&&u.profile.username)||uid;
    const tasks=u.tasks||{};
    Object.keys(tasks).forEach(tid=>{ const t=tasks[tid];
      rows.push([uid+"/"+tid, uname, tid, t.logged||"", t.vertical||"", t.task||"",
        t.client||"", t.orderType||"", t.priority||"", t.due||"", t.event||"",
        t.eventType||"", t.status||"", t.completed||"", t.remarks||""]);
    });
  });
  sh.clearContents();
  sh.getRange(1,1,rows.length,TASK_HEADERS.length).setValues(rows);
  sh.hideColumns(1); // "Key" — leave it alone, PUSH uses it to find the right record
}

function writeProjectSheet_(users){
  const ss=SpreadsheetApp.getActive();
  const sh=ss.getSheetByName("Projects")||ss.insertSheet("Projects");
  const rows=[PROJECT_HEADERS];
  Object.keys(users).forEach(uid=>{
    const u=users[uid]||{}; const uname=(u.profile&&u.profile.username)||uid;
    const projects=u.projects||{};
    Object.keys(projects).forEach(pid=>{ const pr=projects[pid];
      const stages=pr.stages||{}, done=pr.done||{};
      const req=STAGES.filter(s=>stages[s]);
      const doneCount=req.filter(s=>done[s]).length;
      const pct=req.length?Math.round(doneCount/req.length*100):0;
      const status=done["Failed"]?"Failed":(pct===100?"Completed":"In Progress");
      const row=[uid+"/"+pid, uname, pid, pr.name||"", pr.requirements||"", pr.start||"", pr.end||""];
      STAGES.forEach(s=> row.push(!stages[s]?"":(done[s]?"Done":"Pending")));
      row.push(pct, status);
      rows.push(row);
    });
  });
  sh.clearContents();
  sh.getRange(1,1,rows.length,PROJECT_HEADERS.length).setValues(rows);
  sh.hideColumns(1);
}

/* ---------------- PUSH: Sheet -> Firebase (on edit) ---------------- */
function onEdit(e){
  try{
    const sh = e.range.getSheet();
    const name = sh.getName();
    if(name!=="Task Log" && name!=="Projects") return;
    if(e.range.getRow()===1) return; // header row

    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    const key = sh.getRange(e.range.getRow(),1).getValue(); // hidden "Key" column = uid/id
    if(!key) return; // blank/new row — add from the app instead, then Pull
    const uid = key.toString().split("/")[0], id = key.toString().split("/")[1];
    const header = headers[e.range.getColumn()-1];

    const token = getIdToken_();
    if(name==="Task Log"){
      if(!(header in TASK_FIELD)) return;
      const patch={}; patch[TASK_FIELD[header]] = e.range.getValue().toString();
      UrlFetchApp.fetch(dbUrl_()+"/users/"+uid+"/tasks/"+id+".json?auth="+token,
        {method:"patch",contentType:"application/json",payload:JSON.stringify(patch),muteHttpExceptions:true});
    } else {
      const v = e.range.getValue().toString().trim();
      if(header in PROJECT_FIELD){
        const patch={}; patch[PROJECT_FIELD[header]] = v;
        UrlFetchApp.fetch(dbUrl_()+"/users/"+uid+"/projects/"+id+".json?auth="+token,
          {method:"patch",contentType:"application/json",payload:JSON.stringify(patch),muteHttpExceptions:true});
      } else if(STAGES.indexOf(header)!==-1){
        const stagePatch={}; stagePatch[header] = (v==="Pending"||v==="Done");
        const donePatch={}; donePatch[header] = (v==="Done");
        UrlFetchApp.fetch(dbUrl_()+"/users/"+uid+"/projects/"+id+"/stages.json?auth="+token,
          {method:"patch",contentType:"application/json",payload:JSON.stringify(stagePatch),muteHttpExceptions:true});
        UrlFetchApp.fetch(dbUrl_()+"/users/"+uid+"/projects/"+id+"/done.json?auth="+token,
          {method:"patch",contentType:"application/json",payload:JSON.stringify(donePatch),muteHttpExceptions:true});
      }
    }
  }catch(err){
    SpreadsheetApp.getActive().toast("Sync error: "+err.message, "Task Tracker sync", 6);
  }
}

/* ---------------- menu + trigger setup ---------------- */
function onOpen(){
  SpreadsheetApp.getUi().createMenu("Task Tracker")
    .addItem("Pull latest from app now", "pullFromFirebase")
    .addItem("Set up auto-pull every 5 minutes", "setupPullTrigger")
    .addToUi();
}
function setupPullTrigger(){
  ScriptApp.getProjectTriggers().forEach(t=>{
    if(t.getHandlerFunction()==="pullFromFirebase") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("pullFromFirebase").timeBased().everyMinutes(5).create();
  SpreadsheetApp.getActive().toast("Auto-pull every 5 minutes is on.", "Task Tracker sync", 5);
}
