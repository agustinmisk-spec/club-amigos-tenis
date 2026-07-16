/* Servidor de la Escuela de Tenis - Club de Amigos.
   Login real (bcrypt + JWT), permisos por rol, base de datos. */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const store = require('./store');

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

/* Permisos por rol (idénticos al frontend) */
const ROLES = {
  director: { label: 'Director / Coordinador', students: true, config: true, users: true, backup: true, import: true, attendance: true, obs: true, delete: true, content: true },
  admin:    { label: 'Administrativo',         students: true, config: false, users: false, backup: true, import: false, attendance: true, obs: true, delete: false, content: true },
  profesor: { label: 'Profesor/a',             students: false, config: false, users: false, backup: false, import: false, attendance: true, obs: true, delete: false, content: false }
};
const cap = (role, k) => !!(ROLES[role] && ROLES[role][k]);
const publicUser = u => ({ id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol, prof: u.prof || '' });
const uid = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* Middleware de autenticación */
async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No autenticado' });
    const { id } = jwt.verify(token, JWT_SECRET);
    const users = await store.listUsers();
    const u = users.find(x => x.id === id);
    if (!u) return res.status(401).json({ error: 'Sesión inválida' });
    req.user = u;
    next();
  } catch (e) { return res.status(401).json({ error: 'Sesión expirada' }); }
}
const need = k => (req, res, next) => cap(req.user.rol, k) ? next() : res.status(403).json({ error: 'Sin permiso' });

/* ---------------- Auth ---------------- */
app.post('/api/login', async (req, res) => {
  const { usuario, pass } = req.body || {};
  if (!usuario || !pass) return res.status(400).json({ error: 'Faltan datos' });
  const users = await store.listUsers();
  const u = users.find(x => x.usuario.toLowerCase() === String(usuario).trim().toLowerCase());
  if (!u || !bcrypt.compareSync(pass, u.passHash)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  const token = jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: publicUser(u), permisos: ROLES[u.rol] });
});

/* ---------------- Bootstrap (carga inicial) ---------------- */
app.get('/api/bootstrap', auth, async (req, res) => {
  const out = {
    me: publicUser(req.user),
    permisos: ROLES[req.user.rol],
    roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.label])),
    config: await store.getConfig(),
    students: await store.listStudents()
  };
  if (cap(req.user.rol, 'users')) out.users = (await store.listUsers()).map(publicUser);
  res.json(out);
});

/* ---------------- Config ---------------- */
app.put('/api/config', auth, need('config'), async (req, res) => {
  res.json(await store.setConfig(req.body || {}));
});
app.get('/api/storage', auth, need('config'), async (req, res) => {
  try { res.json(await store.storageInfo()); }
  catch (e) { res.status(500).json({ error: 'No disponible' }); }
});

/* ---------------- Alumnos ---------------- */
app.post('/api/students', auth, need('students'), async (req, res) => {
  const s = req.body || {};
  if (!s.id) s.id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  res.json(await store.upsertStudent(s));
});
app.put('/api/students/:id', auth, need('students'), async (req, res) => {
  const s = req.body || {}; s.id = req.params.id;
  res.json(await store.upsertStudent(s));
});
/* Observaciones: permitido también a quien tenga 'obs' aunque no edite alumnos */
app.patch('/api/students/:id/obs', auth, need('obs'), async (req, res) => {
  const list = await store.listStudents();
  const s = list.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'No existe' });
  s.obs = String((req.body && req.body.obs) || '');
  if (req.body && req.body.obsColor != null) s.obsColor = String(req.body.obsColor).slice(0, 20);
  if (req.body) {
    if (req.body.raqueta != null) s.raqueta = String(req.body.raqueta).slice(0, 30);
    if (req.body.raquetaCambiar != null) s.raquetaCambiar = !!req.body.raquetaCambiar;
    if (req.body.fichaTecnica != null) s.fichaTecnica = !!req.body.fichaTecnica;
    if (req.body.video != null) s.video = !!req.body.video;
    if (req.body.fichaDrive != null) s.fichaDrive = String(req.body.fichaDrive).slice(0, 4000);
    if (req.body.fichaReves != null) s.fichaReves = String(req.body.fichaReves).slice(0, 4000);
    if (req.body.fichaFecha != null) s.fichaFecha = String(req.body.fichaFecha).slice(0, 10);
    if (req.body.videoUrl != null) s.videoUrl = String(req.body.videoUrl).slice(0, 500);
    if (Array.isArray(req.body.records)) s.records = req.body.records.slice(0, 60).map(r => ({
      type: ['ficha', 'video', 'link'].includes(r && r.type) ? r.type : 'link',
      fecha: String((r && r.fecha) || '').slice(0, 10),
      drive: String((r && r.drive) || '').slice(0, 4000),
      reves: String((r && r.reves) || '').slice(0, 4000),
      titulo: String((r && r.titulo) || '').slice(0, 200),
      url: String((r && r.url) || '').slice(0, 600),
      nota: String((r && r.nota) || '').slice(0, 3000)
    }));
    if (Array.isArray(req.body.extras)) s.extras = req.body.extras.map(x => String(x).slice(0, 40)).slice(0, 30);
  }
  res.json(await store.upsertStudent(s));
});
app.delete('/api/students/:id', auth, need('delete'), async (req, res) => {
  await store.deleteStudent(req.params.id);
  res.json({ ok: true });
});

/* ---------------- Asistencia ---------------- */
app.get('/api/attendance/stats', auth, async (req, res) => {
  res.json(await store.getAttendanceStats());
});
app.get('/api/attendance', auth, async (req, res) => {
  res.json(await store.getAttendanceByDate(String(req.query.date || '')));
});
app.get('/api/attendance/range', auth, async (req, res) => {
  const from = String(req.query.from || ''), to = String(req.query.to || '');
  if (!from || !to) return res.status(400).json({ error: 'Faltan fechas' });
  res.json(await store.getAttendanceRange(from, to));
});
app.get('/api/attendance/student/:id', auth, async (req, res) => {
  res.json(await store.getAttendanceByStudent(String(req.params.id)));
});
app.put('/api/attendance', auth, need('attendance'), async (req, res) => {
  const { studentId, date, val } = req.body || {};
  if (!studentId || !date) return res.status(400).json({ error: 'Faltan datos' });
  await store.setAttendance(studentId, date, val || null);
  res.json({ ok: true });
});

/* ---------------- Usuarios (solo director) ---------------- */
app.get('/api/users', auth, need('users'), async (req, res) => {
  res.json((await store.listUsers()).map(publicUser));
});
app.post('/api/users', auth, need('users'), async (req, res) => {
  const b = req.body || {};
  if (!b.nombre || !b.usuario || !b.pass) return res.status(400).json({ error: 'Completá nombre, usuario y contraseña' });
  const users = await store.listUsers();
  if (users.some(u => u.usuario.toLowerCase() === b.usuario.toLowerCase())) return res.status(400).json({ error: 'Ese usuario ya existe' });
  const u = { id: uid(), nombre: b.nombre.trim(), usuario: b.usuario.trim(), rol: ROLES[b.rol] ? b.rol : 'profesor',
              prof: b.prof || '', passHash: bcrypt.hashSync(b.pass, 10) };
  await store.rawUpsertUser(u);
  res.json(publicUser(u));
});
app.put('/api/users/:id', auth, need('users'), async (req, res) => {
  const b = req.body || {};
  const users = await store.listUsers();
  const u = users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'No existe' });
  if (b.usuario && users.some(x => x.usuario.toLowerCase() === b.usuario.toLowerCase() && x.id !== u.id))
    return res.status(400).json({ error: 'Ese usuario ya existe' });
  u.nombre = (b.nombre || u.nombre).trim();
  u.usuario = (b.usuario || u.usuario).trim();
  u.rol = ROLES[b.rol] ? b.rol : u.rol;
  u.prof = b.prof || '';
  if (b.pass) u.passHash = bcrypt.hashSync(b.pass, 10);
  await store.rawUpsertUser(u);
  res.json(publicUser(u));
});
app.delete('/api/users/:id', auth, need('users'), async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'No podés eliminar tu propio usuario' });
  const users = await store.listUsers();
  const u = users.find(x => x.id === req.params.id);
  if (u && u.rol === 'director' && users.filter(x => x.rol === 'director').length <= 1)
    return res.status(400).json({ error: 'Debe quedar al menos un Director' });
  await store.deleteUser(req.params.id);
  res.json({ ok: true });
});

/* ---------------- Planificaciones (archivos) ---------------- */
app.get('/api/plans', auth, async (req, res) => { res.json(await store.listPlans()); });
app.post('/api/plans', auth, need('content'), async (req, res) => {
  const b = req.body || {};
  if (!b.dataBase64 && !b.url) return res.status(400).json({ error: 'Falta el archivo o el enlace' });
  const drive = !b.dataBase64 && !!b.url;
  const p = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    nombre: (b.nombre || b.filename || b.url || 'Archivo').toString().slice(0, 200),
    filename: b.filename || 'archivo', mime: b.mime || 'application/octet-stream',
    size: b.size || 0, fecha: new Date().toISOString(), autor: req.user.nombre,
    tipo: drive ? 'drive' : 'archivo', url: drive ? String(b.url).slice(0, 1000) : '' };
  await store.addPlan(p, drive ? '' : b.dataBase64);
  res.json(p);
});
app.get('/api/plans/:id/download', auth, async (req, res) => {
  const p = await store.getPlan(req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  if (p.meta && p.meta.tipo === 'drive' && p.meta.url) return res.redirect(p.meta.url);
  res.setHeader('Content-Type', (p.meta && p.meta.mime) || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent((p.meta && p.meta.filename) || 'archivo') + '"');
  res.send(Buffer.from(p.content || '', 'base64'));
});
app.delete('/api/plans/:id', auth, need('content'), async (req, res) => { await store.deletePlan(req.params.id); res.json({ ok: true }); });

/* ---------------- Comunicaciones (mensajes) ---------------- */
app.get('/api/messages', auth, async (req, res) => { res.json(await store.listMessages()); });
app.post('/api/messages', auth, need('content'), async (req, res) => {
  const b = req.body || {};
  if (!b.texto) return res.status(400).json({ error: 'Falta el mensaje' });
  const m = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    titulo: (b.titulo || '').toString().slice(0, 200), texto: b.texto.toString(),
    fecha: new Date().toISOString(), autor: req.user.nombre };
  await store.addMessage(m);
  res.json(m);
});
app.put('/api/messages/:id', auth, need('content'), async (req, res) => {
  const list = await store.listMessages();
  const m = list.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'No existe' });
  const b = req.body || {};
  if (b.titulo != null) m.titulo = String(b.titulo).slice(0, 200);
  if (b.texto != null) m.texto = String(b.texto);
  await store.updateMessage(m);
  res.json(m);
});
app.delete('/api/messages/:id', auth, need('content'), async (req, res) => { await store.deleteMessage(req.params.id); res.json({ ok: true }); });

/* ---------------- Calendario (eventos) ---------------- */
app.get('/api/events', auth, async (req, res) => { res.json(await store.listEvents()); });
app.post('/api/events', auth, need('content'), async (req, res) => {
  const b = req.body || {};
  if (!b.fecha || !b.titulo) return res.status(400).json({ error: 'Faltan fecha y título' });
  const ev = { id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    fecha: String(b.fecha), titulo: String(b.titulo).slice(0, 200), tipo: String(b.tipo || 'Actividad'),
    nota: String(b.nota || ''), autor: req.user.nombre };
  await store.addEvent(ev);
  res.json(ev);
});
app.put('/api/events/:id', auth, need('content'), async (req, res) => {
  const list = await store.listEvents();
  const e = list.find(x => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'No existe' });
  const b = req.body || {};
  if (b.fecha != null) e.fecha = String(b.fecha);
  if (b.titulo != null) e.titulo = String(b.titulo).slice(0, 200);
  if (b.tipo != null) e.tipo = String(b.tipo);
  if (b.nota != null) e.nota = String(b.nota);
  await store.updateEvent(e);
  res.json(e);
});
app.delete('/api/events/:id', auth, need('content'), async (req, res) => { await store.deleteEvent(req.params.id); res.json({ ok: true }); });

/* ---------------- Capacitaciones ---------------- */
const cleanTraining = b => ({
  fecha: String(b.fecha || ''),
  contenido: String(b.contenido || '').slice(0, 5000),
  materiales: Array.isArray(b.materiales) ? b.materiales.map(x => String(x).slice(0, 500)).slice(0, 60) : [],
  profesores: Array.isArray(b.profesores) ? b.profesores.map(x => String(x).slice(0, 80)).slice(0, 200) : []
});
app.get('/api/trainings', auth, async (req, res) => { res.json(await store.listTrainings()); });
app.post('/api/trainings', auth, need('content'), async (req, res) => {
  const b = req.body || {};
  if (!b.fecha) return res.status(400).json({ error: 'Falta la fecha' });
  const t = Object.assign({ id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }, cleanTraining(b), { autor: req.user.nombre });
  await store.addTraining(t);
  res.json(t);
});
app.put('/api/trainings/:id', auth, need('content'), async (req, res) => {
  const list = await store.listTrainings();
  const t = list.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'No existe' });
  Object.assign(t, cleanTraining(req.body || {}));
  await store.updateTraining(t);
  res.json(t);
});
app.delete('/api/trainings/:id', auth, need('content'), async (req, res) => { await store.deleteTraining(req.params.id); res.json({ ok: true }); });

/* ---------------- Evaluaciones ---------------- */
const cleanEval = b => {
  const scores = {};
  if (b && b.scores && typeof b.scores === 'object') {
    Object.keys(b.scores).slice(0, 300).forEach(k => { const v = parseInt(b.scores[k], 10); if (v >= 1 && v <= 4) scores[String(k).slice(0, 40)] = v; });
  }
  const soc = parseInt(b && b.social, 10);
  return {
    studentId: String((b && b.studentId) || ''),
    periodo: String((b && b.periodo) || '').slice(0, 60),
    fecha: String((b && b.fecha) || ''),
    nivel: String((b && b.nivel) || '').slice(0, 80),
    scores,
    social: (soc >= 1 && soc <= 3) ? soc : null,
    obs: String((b && b.obs) || '').slice(0, 3000)
  };
};
app.get('/api/evaluations', auth, async (req, res) => { res.json(await store.listEvaluations()); });
app.post('/api/evaluations', auth, need('obs'), async (req, res) => {
  const b = req.body || {};
  if (!b.studentId || !(b.periodo || b.fecha)) return res.status(400).json({ error: 'Faltan alumno y período' });
  const clean = cleanEval(b);
  if (clean.periodo) {
    const list = await store.listEvaluations();
    const ex = list.find(x => x.studentId === clean.studentId && x.periodo === clean.periodo);
    if (ex) { Object.assign(ex, clean); await store.updateEvaluation(ex); return res.json(ex); }
  }
  const e = Object.assign({ id: 'ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }, clean, { autor: req.user.nombre });
  await store.addEvaluation(e);
  res.json(e);
});
app.put('/api/evaluations/:id', auth, need('obs'), async (req, res) => {
  const list = await store.listEvaluations();
  const e = list.find(x => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'No existe' });
  Object.assign(e, cleanEval(Object.assign({ studentId: e.studentId }, req.body || {})));
  await store.updateEvaluation(e);
  res.json(e);
});
app.delete('/api/evaluations/:id', auth, need('obs'), async (req, res) => { await store.deleteEvaluation(req.params.id); res.json({ ok: true }); });

/* ---------------- Recuperaciones e invitaciones (por fecha) ---------------- */
app.get('/api/recoveries', auth, async (req, res) => { res.json(await store.listRecoveries()); });
app.post('/api/recoveries', auth, need('attendance'), async (req, res) => {
  const b = req.body || {};
  if (!b.fecha || (!b.studentId && !b.nombre)) return res.status(400).json({ error: 'Faltan fecha y alumno' });
  const r = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    fecha: String(b.fecha), studentId: b.studentId || '', nombre: String(b.nombre || ''),
    tipo: String(b.tipo || 'Recuperación'), hora: String(b.hora || ''), court: String(b.court || ''),
    prof: String(b.prof || ''), nota: String(b.nota || ''), autor: req.user.nombre };
  await store.addRecovery(r);
  res.json(r);
});
app.delete('/api/recoveries/:id', auth, need('attendance'), async (req, res) => { await store.deleteRecovery(req.params.id); res.json({ ok: true }); });

/* ---------------- Competencias ---------------- */
app.get('/api/competitions', auth, async (req, res) => { res.json(await store.listCompetitions()); });
app.post('/api/competitions', auth, need('content'), async (req, res) => {
  const b = req.body || {};
  if (!b.fecha || !b.nombre) return res.status(400).json({ error: 'Faltan fecha y nombre' });
  const c = { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    fecha: String(b.fecha), nombre: String(b.nombre).slice(0, 200), lugar: String(b.lugar || ''),
    nota: String(b.nota || ''), participantes: Array.isArray(b.participantes) ? b.participantes : [], autor: req.user.nombre };
  await store.addCompetition(c);
  res.json(c);
});
app.put('/api/competitions/:id', auth, need('content'), async (req, res) => {
  const list = await store.listCompetitions();
  const c = list.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'No existe' });
  const b = req.body || {};
  if (b.fecha != null) c.fecha = String(b.fecha);
  if (b.nombre != null) c.nombre = String(b.nombre).slice(0, 200);
  if (b.lugar != null) c.lugar = String(b.lugar);
  if (b.nota != null) c.nota = String(b.nota);
  if (Array.isArray(b.participantes)) c.participantes = b.participantes;
  await store.updateCompetition(c);
  res.json(c);
});
app.delete('/api/competitions/:id', auth, need('content'), async (req, res) => { await store.deleteCompetition(req.params.id); res.json({ ok: true }); });

/* ---------------- Historial de cambios ---------------- */
app.get('/api/changes', auth, async (req, res) => { res.json(await store.listChanges()); });
app.post('/api/changes', auth, need('students'), async (req, res) => {
  const b = req.body || {};
  const ch = { id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    fecha: new Date().toISOString(), studentId: b.studentId || '', nombre: String(b.nombre || ''),
    descripcion: String(b.descripcion || ''), obs: '', cerrado: false, autor: req.user.nombre };
  await store.addChange(ch);
  res.json(ch);
});
app.patch('/api/changes/:id', auth, need('content'), async (req, res) => {
  const list = await store.listChanges();
  const ch = list.find(x => x.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'No existe' });
  const b = req.body || {};
  if (b.obs != null) ch.obs = String(b.obs);
  if (b.cerrado != null) ch.cerrado = !!b.cerrado;
  await store.updateChange(ch);
  res.json(ch);
});
app.delete('/api/changes/:id', auth, need('content'), async (req, res) => { await store.deleteChange(req.params.id); res.json({ ok: true }); });

/* ---------------- Editar recuperación ---------------- */
app.put('/api/recoveries/:id', auth, need('attendance'), async (req, res) => {
  const list = await store.listRecoveries();
  const r = list.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'No existe' });
  const b = req.body || {};
  ['fecha','studentId','nombre','tipo','hora','court','prof','nota'].forEach(k => { if (b[k] != null) r[k] = String(b[k]); });
  await store.updateRecovery(r);
  res.json(r);
});

/* ---------------- Observaciones de grupo ---------------- */
app.get('/api/groupnotes', auth, async (req, res) => { res.json(await store.listGroupNotes()); });
app.put('/api/groupnotes', auth, need('content'), async (req, res) => {
  const b = req.body || {};
  if (!b.dia || !b.hora) return res.status(400).json({ error: 'Faltan datos' });
  const key = [b.dia, b.hora, b.prof || ''].join('|');
  const data = b.nota ? { key, dia: String(b.dia), hora: String(b.hora), prof: String(b.prof || ''), nota: String(b.nota), autor: req.user.nombre } : null;
  await store.setGroupNote(key, data);
  res.json({ ok: true, key });
});

app.get('/api/health', (req, res) => res.json({ ok: true, mode: store.MODE }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

store.init()
  .then(() => app.listen(PORT, () => console.log(`Escuela de Tenis - Club de Amigos\nModo almacenamiento: ${store.MODE}\nServidor en http://localhost:${PORT}`)))
  .catch(e => { console.error('Error al iniciar:', e); process.exit(1); });
