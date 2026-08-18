"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const core=require("../app-core.js");

test("migrates legacy localized tags and paused duration",()=>{
  const data=core.migrate({sessions:[{id:"a",start:"2026-01-01T10:00:00Z",end:"2026-01-01T12:00:00Z",pausedMs:1800000,note:{tags:["Первое посещение","Bible study"]}}],settings:{lang:"en"}});
  assert.equal(data.schemaVersion,2);
  assert.deepEqual(data.sessions[0].note.tags,["first_visit","bible_study"]);
  assert.equal(data.sessions[0].elapsedMs,5400000);
});

test("merge sums real durations rather than wall-clock span",()=>{
  const a=core.migrate({sessions:[{id:"a",start:"2026-01-01T10:00:00Z",end:"2026-01-01T11:00:00Z",pausedMs:600000,note:{tags:[]}}]}).sessions[0];
  const b=core.migrate({sessions:[{id:"b",start:"2026-01-01T15:00:00Z",end:"2026-01-01T16:00:00Z",note:{tags:[]}}]}).sessions[0];
  assert.equal(core.durationMs(core.mergeSessions(a,b)),6600000);
});

test("split preserves exact total duration and isolates note arrays",()=>{
  const s=core.migrate({sessions:[{id:"a",start:"2026-01-01T10:00:00Z",end:"2026-01-01T12:00:00Z",elapsedMs:4500001,note:{tags:["first_visit"]}}]}).sessions[0];
  const parts=core.splitSession(s);
  assert.equal(core.durationMs(parts[0])+core.durationMs(parts[1]),4500001);
  parts[0].note.tags.push("bible_study");
  assert.deepEqual(parts[1].note.tags,["first_visit"]);
});

test("rejects malformed or future backups",()=>{
  assert.throws(()=>core.validateBackup({schemaVersion:999,sessions:[]}));
  assert.throws(()=>core.validateBackup({sessions:[{start:"bad"}]}));
});

test("storage migrates legacy keys into atomic primary document",()=>{
  const map=new Map([["ministry-sessions",JSON.stringify([{id:"a",start:"2026-01-01T10:00:00Z",end:"2026-01-01T11:00:00Z",note:{tags:[]}}])]]);
  const storage={getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  const data=core.createStorage(storage).load();
  assert.equal(data.sessions.length,1);
  assert.ok(map.has(core.DATA_KEY));
});

test("goal notes: keeps valid month notes, drops malformed/empty entries",()=>{
  const data=core.migrate({sessions:[],goalNotes:{
    "2026-06":{note:"Болел неделю",dismissedAt:"2026-07-02T08:00:00Z"},
    "2026-07":{dismissedAt:"2026-08-01T09:00:00Z"},          // skipped without a note — still meaningful
    "not-a-month":{note:"x",dismissedAt:"2026-07-02T08:00:00Z"}, // bad key
    "2026-05":{note:"",dismissedAt:null}                      // nothing to keep
  }});
  assert.deepEqual(Object.keys(data.goalNotes).sort(),["2026-06","2026-07"]);
  assert.equal(data.goalNotes["2026-06"].note,"Болел неделю");
  assert.equal(data.goalNotes["2026-07"].note,"");
});
