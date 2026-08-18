(function(root, factory){
  var api = factory();
  if(typeof module === "object" && module.exports) module.exports = api;
  else root.ServiceTimerCore = api;
})(typeof self !== "undefined" ? self : this, function(){
  "use strict";

  var SCHEMA_VERSION = 2;
  var DATA_KEY = "service-timer:data";
  var LEGACY_SESSIONS_KEY = "ministry-sessions";
  var LEGACY_SETTINGS_KEY = "ministry-settings";
  var TAG_IDS = ["first_visit", "return_visit", "bible_study", "informal_witnessing"];
  var LEGACY_TAGS = {
    "Первое посещение":"first_visit", "Перше відвідування":"first_visit", "Erstbesuch":"first_visit", "First visit":"first_visit",
    "Повторное посещение":"return_visit", "Повторне відвідування":"return_visit", "Rückbesuch":"return_visit", "Return visit":"return_visit",
    "Изучение":"bible_study", "Вивчення":"bible_study", "Bibelstudium":"bible_study", "Bible study":"bible_study",
    "Неформальное свидетельство":"informal_witnessing", "Неформальне свідчення":"informal_witnessing", "Informelles Zeugnisgeben":"informal_witnessing", "Informal witnessing":"informal_witnessing"
  };
  var DEFAULT_SETTINGS = { goalHours:30, theme:"auto", timeFormat:24, weekStart:1, lang:"ru", accentColor:"#0F6E56" };

  function uid(){
    if(typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "st-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
  }
  function finiteNumber(v, fallback){ v=Number(v); return Number.isFinite(v) ? v : fallback; }
  function iso(v){ var d=new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString() : null; }
  function cleanText(v, max){ return typeof v === "string" ? v.slice(0,max) : ""; }
  function normalizeTags(tags){
    if(!Array.isArray(tags)) return [];
    return Array.from(new Set(tags.map(function(tag){ return LEGACY_TAGS[tag] || (TAG_IDS.indexOf(tag)>=0 ? tag : null); }).filter(Boolean)));
  }
  function normalizeSession(input, index){
    if(!input || typeof input !== "object") return null;
    var start=iso(input.start), end=input.end==null ? null : iso(input.end);
    if(!start || (input.end!=null && !end)) return null;
    if(end && new Date(end) < new Date(start)) return null;
    var note=input.note && typeof input.note === "object" ? input.note : {};
    var pausedMs=Math.max(0,finiteNumber(input.pausedMs,0));
    var elapsedMs=input.elapsedMs==null ? null : Math.max(0,finiteNumber(input.elapsedMs,0));
    var wall=end ? new Date(end)-new Date(start) : null;
    if(elapsedMs==null && end) elapsedMs=Math.max(0,wall-pausedMs);
    if(elapsedMs!=null) elapsedMs=Math.min(elapsedMs,10*365*24*60*60*1000);
    return {
      id: typeof input.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(input.id) ? input.id : uid()+"-"+(index||0),
      start:start, end:end, paused:!end && input.paused===true,
      pausedAt:!end && input.paused===true ? iso(input.pausedAt) : null,
      pausedMs:pausedMs, elapsedMs:elapsedMs,
      note:{ territory:cleanText(note.territory,500), partner:cleanText(note.partner,500), comment:cleanText(note.comment,10000), tags:normalizeTags(note.tags) },
      excluded:input.excluded===true
    };
  }
  function normalizeSettings(input){
    input=input && typeof input === "object" ? input : {};
    var out=Object.assign({},DEFAULT_SETTINGS);
    var goal=finiteNumber(input.goalHours,30); out.goalHours=goal>0 && goal<=1000 ? goal : 30;
    out.theme=["light","dark","auto"].indexOf(input.theme)>=0 ? input.theme : "auto";
    out.timeFormat=Number(input.timeFormat)===12 ? 12 : 24;
    out.weekStart=Number(input.weekStart)===0 ? 0 : 1;
    out.lang=["ru","uk","de","en"].indexOf(input.lang)>=0 ? input.lang : "ru";
    out.accentColor=/^#[0-9a-f]{6}$/i.test(input.accentColor||"") ? input.accentColor : DEFAULT_SETTINGS.accentColor;
    return out;
  }
  // Notes attached to a whole month explaining why the service-hours goal wasn't
  // met, keyed by "YYYY-MM". Kept separate from per-session notes (note.comment)
  // since those describe an individual visit, not a monthly shortfall.
  function normalizeGoalNotes(input){
    if(!input || typeof input !== "object") return {};
    var out={};
    Object.keys(input).forEach(function(key){
      if(!/^\d{4}-\d{2}$/.test(key)) return;
      var v=input[key];
      if(!v || typeof v !== "object") return;
      var note=cleanText(v.note,2000);
      var dismissedAt=v.dismissedAt ? iso(v.dismissedAt) : null;
      var updatedAt=v.updatedAt ? iso(v.updatedAt) : null;
      if(!note && !dismissedAt) return; // nothing worth keeping
      out[key]={ note:note, dismissedAt:dismissedAt, updatedAt:updatedAt };
    });
    return out;
  }
  function migrate(raw){
    raw=raw && typeof raw === "object" ? raw : {};
    var sessions=Array.isArray(raw.sessions) ? raw.sessions.map(normalizeSession).filter(Boolean) : [];
    var seen={}; sessions.forEach(function(s){ if(seen[s.id]) s.id=uid(); seen[s.id]=true; });
    return { schemaVersion:SCHEMA_VERSION, exportedAt:iso(raw.exportedAt)||new Date().toISOString(), sessions:sessions, settings:normalizeSettings(raw.settings), goalNotes:normalizeGoalNotes(raw.goalNotes) };
  }
  function validateBackup(raw){
    if(!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Backup must be an object");
    if(raw.schemaVersion!=null && (!Number.isInteger(raw.schemaVersion) || raw.schemaVersion<1 || raw.schemaVersion>SCHEMA_VERSION)) throw new Error("Unsupported schemaVersion");
    if(!Array.isArray(raw.sessions)) throw new Error("Missing sessions array");
    if(raw.sessions.length>100000) throw new Error("Too many sessions");
    var migrated=migrate(raw);
    if(migrated.sessions.length!==raw.sessions.length) throw new Error("Invalid session data");
    return migrated;
  }
  function durationMs(s, now){
    if(s.end && Number.isFinite(s.elapsedMs)) return Math.max(0,s.elapsedMs);
    var end=s.end ? new Date(s.end) : new Date(now||Date.now());
    var paused=Math.max(0,finiteNumber(s.pausedMs,0));
    if(s.paused && s.pausedAt) paused+=Math.max(0,end-new Date(s.pausedAt));
    return Math.max(0,end-new Date(s.start)-paused);
  }
  function mergeSessions(a,b){
    if(!a || !b || !a.end || !b.end) throw new Error("Only completed sessions can be merged");
    var start=new Date(a.start)<new Date(b.start)?a.start:b.start;
    var end=new Date(a.end)>new Date(b.end)?a.end:b.end;
    var noteA=a.note||{}, noteB=b.note||{};
    return normalizeSession({id:uid(),start:start,end:end,elapsedMs:durationMs(a)+durationMs(b),note:{
      territory:noteA.territory||noteB.territory||"", partner:noteA.partner||noteB.partner||"",
      comment:[noteA.comment,noteB.comment].filter(Boolean).join(" / "), tags:(noteA.tags||[]).concat(noteB.tags||[])
    },excluded:a.excluded||b.excluded});
  }
  function splitSession(s){
    if(!s || !s.end) throw new Error("Only completed sessions can be split");
    var total=durationMs(s), firstDuration=Math.floor(total/2), secondDuration=total-firstDuration;
    var mid=new Date((new Date(s.start).getTime()+new Date(s.end).getTime())/2).toISOString();
    var first=normalizeSession(Object.assign({},s,{end:mid,elapsedMs:firstDuration,note:Object.assign({},s.note,{tags:(s.note.tags||[]).slice()})}));
    var second=normalizeSession(Object.assign({},s,{id:uid(),start:mid,elapsedMs:secondDuration,note:Object.assign({},s.note,{tags:(s.note.tags||[]).slice()})}));
    return [first,second];
  }
  function createStorage(storage){
    function readJson(key){ var v=storage.getItem(key); return v==null?null:JSON.parse(v); }
    return {
      load:function(){
        var data;
        try{ data=readJson(DATA_KEY); }catch(e){ data=null; }
        if(!data){ try{ data=readJson(DATA_KEY+":tmp"); }catch(e){ data=null; } }
        if(!data){
          var sessions=[], settings={};
          try{ sessions=readJson(LEGACY_SESSIONS_KEY)||[]; }catch(e){}
          try{ settings=readJson(LEGACY_SETTINGS_KEY)||{}; }catch(e){}
          data={sessions:sessions,settings:settings};
        }
        data=migrate(data); this.save(data); return data;
      },
      save:function(data){
        var normalized=migrate(data), json=JSON.stringify(normalized);
        storage.setItem(DATA_KEY+":tmp",json);
        storage.setItem(DATA_KEY,json);
        storage.removeItem(DATA_KEY+":tmp");
        return normalized;
      }
    };
  }
  return {SCHEMA_VERSION:SCHEMA_VERSION,DATA_KEY:DATA_KEY,TAG_IDS:TAG_IDS,DEFAULT_SETTINGS:DEFAULT_SETTINGS,uid:uid,migrate:migrate,validateBackup:validateBackup,durationMs:durationMs,mergeSessions:mergeSessions,splitSession:splitSession,createStorage:createStorage,normalizeTags:normalizeTags,normalizeGoalNotes:normalizeGoalNotes};
});
