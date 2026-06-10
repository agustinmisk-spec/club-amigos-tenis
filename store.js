/* Capa de almacenamiento.
   - Si existe DATABASE_URL  -> PostgreSQL (producción, persistente, multiusuario).
   - Si no                   -> archivo JSON local (./data/db.json) para probar sin nube.
   La interfaz es idéntica en ambos casos. */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const USE_PG = !!process.env.DATABASE_URL;

/* ---------------- helpers de seed ---------------- */
function loadSeed() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-data.json'), 'utf8')); }
  catch (e) { return { config: {}, students: [] }; }
}
function defaultDirector() {
  return {
    id: 'u_director',
    nombre: 'Director',
    usuario: 'director',
    rol: 'director',
    prof: '',
    passHash: bcrypt.hashSync('director', 10)
  };
}

/* =====================================================================
   IMPLEMENTACIÓN POSTGRES
   ===================================================================== */
function pgStore() {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false }
  });

  async function q(text, params) { return (await pool.query(text, params)).rows; }

  async function init() {
    await q(`CREATE TABLE IF NOT EXISTS kv (key text PRIMARY KEY, val jsonb NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS students (id text PRIMARY KEY, data jsonb NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, data jsonb NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS attendance (student_id text, dt text, val text, PRIMARY KEY(student_id, dt))`);
    await q(`CREATE TABLE IF NOT EXISTS plans (id text PRIMARY KEY, meta jsonb NOT NULL, content text)`);
    await q(`CREATE TABLE IF NOT EXISTS messages (id text PRIMARY KEY, data jsonb NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS events (id text PRIMARY KEY, data jsonb NOT NULL)`);
    const seed = loadSeed();
    if (!(await getConfig())) await setConfig(seed.config || {});
    if ((await countStudents()) === 0 && Array.isArray(seed.students)) {
      for (const s of seed.students) await upsertStudent(s);
    }
    if ((await countUsers()) === 0) await rawUpsertUser(defaultDirector());
  }

  async function getConfig() { const r = await q(`SELECT val FROM kv WHERE key='config'`); return r[0] ? r[0].val : null; }
  async function setConfig(obj) { await q(`INSERT INTO kv(key,val) VALUES('config',$1) ON CONFLICT(key) DO UPDATE SET val=$1`, [obj]); return obj; }

  async function listStudents() { return (await q(`SELECT data FROM students`)).map(r => r.data); }
  async function upsertStudent(s) { await q(`INSERT INTO students(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2`, [s.id, s]); return s; }
  async function deleteStudent(id) { await q(`DELETE FROM students WHERE id=$1`, [id]); }
  async function countStudents() { return parseInt((await q(`SELECT count(*) c FROM students`))[0].c, 10); }

  async function listUsers() { return (await q(`SELECT data FROM users`)).map(r => r.data); }
  async function rawUpsertUser(u) { await q(`INSERT INTO users(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2`, [u.id, u]); return u; }
  async function deleteUser(id) { await q(`DELETE FROM users WHERE id=$1`, [id]); }
  async function countUsers() { return parseInt((await q(`SELECT count(*) c FROM users`))[0].c, 10); }

  async function getAttendanceByDate(dt) {
    const rows = await q(`SELECT student_id, val FROM attendance WHERE dt=$1`, [dt]);
    const m = {}; rows.forEach(r => m[r.student_id] = r.val); return m;
  }
  async function setAttendance(studentId, dt, val) {
    if (val == null) await q(`DELETE FROM attendance WHERE student_id=$1 AND dt=$2`, [studentId, dt]);
    else await q(`INSERT INTO attendance(student_id,dt,val) VALUES($1,$2,$3) ON CONFLICT(student_id,dt) DO UPDATE SET val=$3`, [studentId, dt, val]);
  }

  async function getAttendanceStats() {
    const rows = await q(`SELECT student_id, val, count(*)::int c FROM attendance GROUP BY student_id, val`);
    const m = {}; rows.forEach(r => { const o=(m[r.student_id]=m[r.student_id]||{p:0,a:0,s:0}); if(r.val==='P')o.p=r.c; else if(r.val==='A')o.a=r.c; else if(r.val&&r.val[0]==='S')o.s+=r.c; }); return m;
  }

  async function listPlans() { return (await q(`SELECT meta FROM plans ORDER BY meta->>'fecha' DESC`)).map(r => r.meta); }
  async function addPlan(p, content) { await q(`INSERT INTO plans(id,meta,content) VALUES($1,$2,$3)`, [p.id, p, content]); return p; }
  async function getPlan(id) { const r = await q(`SELECT meta, content FROM plans WHERE id=$1`, [id]); return r[0] ? { meta: r[0].meta, content: r[0].content } : null; }
  async function deletePlan(id) { await q(`DELETE FROM plans WHERE id=$1`, [id]); }
  async function listMessages() { return (await q(`SELECT data FROM messages ORDER BY data->>'fecha' DESC`)).map(r => r.data); }
  async function addMessage(m) { await q(`INSERT INTO messages(id,data) VALUES($1,$2)`, [m.id, m]); return m; }
  async function deleteMessage(id) { await q(`DELETE FROM messages WHERE id=$1`, [id]); }
  async function listEvents() { return (await q(`SELECT data FROM events ORDER BY data->>'fecha'`)).map(r => r.data); }
  async function addEvent(ev) { await q(`INSERT INTO events(id,data) VALUES($1,$2)`, [ev.id, ev]); return ev; }
  async function deleteEvent(id) { await q(`DELETE FROM events WHERE id=$1`, [id]); }

  return { init, getConfig, setConfig, listStudents, upsertStudent, deleteStudent, countStudents,
           listUsers, rawUpsertUser, deleteUser, countUsers, getAttendanceByDate, setAttendance, getAttendanceStats,
           listPlans, addPlan, getPlan, deletePlan, listMessages, addMessage, deleteMessage,
           listEvents, addEvent, deleteEvent };
}

/* =====================================================================
   IMPLEMENTACIÓN JSON (archivo local, sin base de datos)
   ===================================================================== */
function jsonStore() {
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
  const file = path.join(dir, 'db.json');
  let db = { config: null, students: [], users: [], attendance: {}, plans: [], messages: [], events: [] };

  function persist() { fs.writeFileSync(file, JSON.stringify(db)); }

  async function init() {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file)) { try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {} }
    const seed = loadSeed();
    if (!db.config) db.config = seed.config || {};
    if (!db.students.length && Array.isArray(seed.students)) db.students = seed.students.slice();
    if (!db.users.length) db.users = [defaultDirector()];
    if (!db.attendance) db.attendance = {};
    if (!db.plans) db.plans = [];
    if (!db.messages) db.messages = [];
    if (!db.events) db.events = [];
    persist();
  }

  async function getConfig() { return db.config; }
  async function setConfig(obj) { db.config = obj; persist(); return obj; }

  async function listStudents() { return db.students.slice(); }
  async function upsertStudent(s) { const i = db.students.findIndex(x => x.id === s.id); if (i >= 0) db.students[i] = s; else db.students.push(s); persist(); return s; }
  async function deleteStudent(id) { db.students = db.students.filter(x => x.id !== id); persist(); }
  async function countStudents() { return db.students.length; }

  async function listUsers() { return db.users.slice(); }
  async function rawUpsertUser(u) { const i = db.users.findIndex(x => x.id === u.id); if (i >= 0) db.users[i] = u; else db.users.push(u); persist(); return u; }
  async function deleteUser(id) { db.users = db.users.filter(x => x.id !== id); persist(); }
  async function countUsers() { return db.users.length; }

  async function getAttendanceByDate(dt) {
    const m = {}; Object.keys(db.attendance).forEach(k => { const [sid, d] = k.split('|'); if (d === dt) m[sid] = db.attendance[k]; }); return m;
  }
  async function setAttendance(studentId, dt, val) {
    const k = studentId + '|' + dt;
    if (val == null) delete db.attendance[k]; else db.attendance[k] = val;
    persist();
  }

  async function getAttendanceStats() {
    const m = {}; Object.keys(db.attendance).forEach(k => { const sid=k.split('|')[0]; const v=db.attendance[k]; const o=(m[sid]=m[sid]||{p:0,a:0,s:0}); if(v==='P')o.p++; else if(v==='A')o.a++; else if(v&&v[0]==='S')o.s++; }); return m;
  }

  async function listPlans() { return db.plans.map(({ content, ...meta }) => meta).sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')); }
  async function addPlan(p, content) { db.plans.push({ ...p, content }); persist(); return p; }
  async function getPlan(id) { const p = db.plans.find(x => x.id === id); if(!p) return null; const { content, ...meta } = p; return { meta, content }; }
  async function deletePlan(id) { db.plans = db.plans.filter(x => x.id !== id); persist(); }
  async function listMessages() { return db.messages.slice().sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')); }
  async function addMessage(m) { db.messages.push(m); persist(); return m; }
  async function deleteMessage(id) { db.messages = db.messages.filter(x => x.id !== id); persist(); }
  async function listEvents() { return db.events.slice().sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||'')); }
  async function addEvent(ev) { db.events.push(ev); persist(); return ev; }
  async function deleteEvent(id) { db.events = db.events.filter(x => x.id !== id); persist(); }

  return { init, getConfig, setConfig, listStudents, upsertStudent, deleteStudent, countStudents,
           listUsers, rawUpsertUser, deleteUser, countUsers, getAttendanceByDate, setAttendance, getAttendanceStats,
           listPlans, addPlan, getPlan, deletePlan, listMessages, addMessage, deleteMessage,
           listEvents, addEvent, deleteEvent };
}

const store = USE_PG ? pgStore() : jsonStore();
store.MODE = USE_PG ? 'postgres' : 'json-file';
module.exports = store;

