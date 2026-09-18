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

const STAGES = ["L1","BOQ","TEC","Awarded","Procurement","Inventory","Production","QC",
  "Testing","Dispatch","Delivered","Payment","Documentation","Failed"];
const VERTICALS = ["Defence","Industry","Tenders","RPTO","RPTO Establishment","DaaS",
  "V V Yatra","Redington","CoE","Global","Agri Drone","Agri Services"];
const ORDER_TYPES = ["Drone Sale - Govt Order","Drone Sale - Private","Service / DaaS",
  "Tender / Bid","Training","Internal / Admin"];
const EVENT_TYPES = ["Demo","Delivery / Dispatch","Inspection","Tender Submission",
  "Training Batch","Site Survey","Go-Live","Review Meeting","Payment / Invoice","Other"];
const PRIORITIES = ["High","Medium","Low"];
const STATUSES = ["Not Started","In Progress","On Hold","Completed"];

const TASK_FIELD = { // sheet header -> Firebase field name ("Task ID" is computed, never pushed)
  "Assigned To":"assignedTo","Date Logged":"logged","Vertical":"vertical","Task Description":"task",
  "Client / Customer":"client","Order Type":"orderType","Priority":"priority",
  "Due Date":"due","Execution / Event Date":"event","Event Type":"eventType",
  "Status":"status","Completed Date":"completed","Remarks":"remarks"
};
const PROJECT_FIELD = {
  "Project ID":"projectId","Project Name":"name","Vertical":"vertical",
  "Requirements":"requirements","Start Date":"start","End Date":"end"
};

const TASK_HEADERS = ["Key","Task ID","Assigned To","Date Logged","Vertical","Task Description",
  "Client / Customer","Order Type","Priority","Due Date","Execution / Event Date",
  "Event Type","Status","Completed Date","Remarks"];
const PROJECT_HEADERS = ["Key","Project ID","Project Name","Vertical","Requirements","Start Date","End Date"]
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

/* ---------------- dropdowns ---------------- */
function applyListValidation_(sh, col, list, dataRowCount){
  const numRows = Math.max(dataRowCount, 200); // leave headroom for rows added later
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build();
  sh.getRange(2, col, numRows, 1).setDataValidation(rule);
}

/* ---------------- daily task numbering ---------------- */
// Same rule as the app: Task ID resets every day starting at 1. Carried-forward open
// tasks (logged before today, still not Completed) are numbered first; tasks added
// today come after them. Completed tasks carry no number. Computed per user.
function todayStr_(){
  return Utilities.formatDate(new Date(), SpreadsheetApp.getActive().getSpreadsheetTimeZone(), "yyyy-MM-dd");
}
function computeTaskIds_(entries, today){ // entries: [[tid, taskObj], ...]
  const open = entries.filter(function(e){ return (e[1].status||"")!=="Completed"; });
  const carry = open.filter(function(e){ return e[1].logged && e[1].logged<today; });
  const added = open.filter(function(e){ return !(e[1].logged && e[1].logged<today); });
  const byDue = function(a,b){
    return (a[1].due||"9999-99-99").localeCompare(b[1].due||"9999-99-99")
      || (a[1].logged||"").localeCompare(b[1].logged||"")
      || a[0].localeCompare(b[0]);
  };
  carry.sort(byDue); added.sort(byDue);
  const map={};
  carry.concat(added).forEach(function(e,i){ map[e[0]]=i+1; });
  return map;
}

/* ---------------- PULL: Firebase -> Sheet ---------------- */
function fetchUsers_(token){
  const res = UrlFetchApp.fetch(dbUrl_()+"/users.json?auth="+token, {muteHttpExceptions:true});
  const code = res.getResponseCode();
  const body = res.getContentText();
  if(code!==200) throw new Error("Firebase rejected the request (HTTP "+code+"): "+body+
    ". Check FIREBASE_EMAIL/FIREBASE_PASSWORD are correct, that account has role \"admin\" in "+
    "the database, and that database.rules.json (with the \"projects\" node) is Published.");
  let data;
  try{ data = JSON.parse(body); }catch(e){ throw new Error("Firebase returned something unexpected: "+body); }
  if(data && typeof data==="object" && !Array.isArray(data) && data.error)
    throw new Error("Firebase error: "+data.error);
  return data || {};
}

function pullFromFirebase(){
  try{
    const token = getIdToken_();
    const users = fetchUsers_(token);
    writeTaskSheet_(users);
    writeProjectSheet_(users);
    const n = Object.keys(users).length;
    const msg = n?("Synced "+n+" user(s).") : "Synced, but no users found under this login.";
    Logger.log(msg);
    try{ SpreadsheetApp.getActive().toast(msg, "Task Tracker sync", 5); }catch(e){}
  }catch(err){
    Logger.log("SYNC FAILED: "+err.message); // always visible in Executions / Execution log
    try{
      SpreadsheetApp.getUi().alert("Sync failed", err.message, SpreadsheetApp.getUi().ButtonSet.OK);
    }catch(e){
      // No UI context (e.g. run directly from the Apps Script editor rather than the
      // Sheet's own menu) — the error above is still visible in Executions / Execution log.
    }
    throw err;
  }
}

function writeTaskSheet_(users){
  const ss=SpreadsheetApp.getActive();
  let sh=ss.getSheetByName("Task Log");
  if(sh){ // wipe everything, including leftover validation/formatting from any earlier import
    sh.clear();
    sh.getRange(1,1,Math.max(sh.getMaxRows(),1),Math.max(sh.getMaxColumns(),1)).clearDataValidations();
    sh.clearConditionalFormatRules();
  } else {
    sh=ss.insertSheet("Task Log");
  }
  const today = todayStr_();
  const rows=[TASK_HEADERS];
  Object.keys(users).forEach(uid=>{
    const u=users[uid]||{};
    const tasks=u.tasks||{};
    const entries=Object.keys(tasks).map(tid=>[tid, tasks[tid]]);
    const idMap=computeTaskIds_(entries, today);
    entries.forEach(([tid,t])=>{
      rows.push([uid+"/"+tid, idMap[tid]||"", t.assignedTo||"", t.logged||"", t.vertical||"", t.task||"",
        t.client||"", t.orderType||"", t.priority||"", t.due||"", t.event||"",
        t.eventType||"", t.status||"", t.completed||"", t.remarks||""]);
    });
  });
  sh.getRange(1,1,rows.length,TASK_HEADERS.length).setValues(rows);
  sh.getRange(1,1,1,TASK_HEADERS.length).setFontWeight("bold");
  sh.setFrozenRows(1);
  sh.hideColumns(1); // "Key" — leave it alone, PUSH uses it to find the right record
  // dropdowns, matching the app's own field options
  applyListValidation_(sh, 5, VERTICALS, rows.length);   // Vertical
  applyListValidation_(sh, 8, ORDER_TYPES, rows.length); // Order Type
  applyListValidation_(sh, 9, PRIORITIES, rows.length);  // Priority
  applyListValidation_(sh, 12, EVENT_TYPES, rows.length);// Event Type
  applyListValidation_(sh, 13, STATUSES, rows.length);   // Status
}

function writeProjectSheet_(users){
  const ss=SpreadsheetApp.getActive();
  let sh=ss.getSheetByName("Projects");
  if(sh){
    sh.clear();
    sh.getRange(1,1,Math.max(sh.getMaxRows(),1),Math.max(sh.getMaxColumns(),1)).clearDataValidations();
    sh.clearConditionalFormatRules();
  } else {
    sh=ss.insertSheet("Projects");
  }
  const rows=[PROJECT_HEADERS];
  Object.keys(users).forEach(uid=>{
    const u=users[uid]||{};
    const projects=u.projects||{};
    Object.keys(projects).forEach(pid=>{ const pr=projects[pid];
      const stages=pr.stages||{}, done=pr.done||{};
      const req=STAGES.filter(s=>stages[s]);
      const doneCount=req.filter(s=>done[s]).length;
      const pct=req.length?Math.round(doneCount/req.length*100):0;
      const status=done["Failed"]?"Failed":(pct===100?"Completed":"In Progress");
      const row=[uid+"/"+pid, pr.projectId||"", pr.name||"", pr.vertical||"", pr.requirements||"", pr.start||"", pr.end||""];
      STAGES.forEach(s=> row.push(!stages[s]?"":(done[s]?"Done":"Pending")));
      row.push(pct, status);
      rows.push(row);
    });
  });
  sh.getRange(1,1,rows.length,PROJECT_HEADERS.length).setValues(rows);
  sh.getRange(1,1,1,PROJECT_HEADERS.length).setFontWeight("bold");
  sh.setFrozenRows(1);
  sh.hideColumns(1);
  applyListValidation_(sh, 4, VERTICALS, rows.length); // Vertical
  // dropdowns for every stage column (Pending / Done)
  STAGES.forEach((s,i)=> applyListValidation_(sh, 8+i, ["Pending","Done"], rows.length));
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
      if(header==="Task ID"){
        SpreadsheetApp.getActive().toast("Task ID is calculated automatically (carry-forwards first, each day) — it can't be set by hand. Your edit wasn't sent.", "Task Tracker sync", 6);
        return;
      }
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
