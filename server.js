/* Servidor de la Escuela de Tenis - Club de Amigos.
   Login real (bcrypt + JWT), permisos por rol, base de datos. */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const store = require('./store');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

/* Permisos por rol (idénticos al frontend) */
const ROLES = {
  director: { label: 'Director / Coordinador', students: true, config: true, users: true, backup: true, import: true, attendance: true, obs: true, delete: true },
  admin:    { label: 'Administrativo',         students: true, config: false, users: false, backup: true, import: false, attendance: true, obs: true, delete: false },
  profesor: { label: 'Profesor/a',             students: false, config: false, users: false, backup: false, import: false, attendance: true, obs: true, delete: false }
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
  res.json(await store.upsertStudent(s));
});
app.delete('/api/students/:id', auth, need('delete'), async (req, res) => {
  await store.deleteStudent(req.params.id);
  res.json({ ok: true });
});

/* ---------------- Asistencia ---------------- */
app.get('/api/attendance', auth, async (req, res) => {
  res.json(await store.getAttendanceByDate(String(req.query.date || '')));
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
              prof: b.rol === 'profesor' ? (b.prof || '') : '', passHash: bcrypt.hashSync(b.pass, 10) };
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
  u.prof = u.rol === 'profesor' ? (b.prof || '') : '';
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

app.get('/api/health', (req, res) => res.json({ ok: true, mode: store.MODE }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

store.init()
  .then(() => app.listen(PORT, () => console.log(`Escuela de Tenis - Club de Amigos\nModo almacenamiento: ${store.MODE}\nServidor en http://localhost:${PORT}`)))
  .catch(e => { console.error('Error al iniciar:', e); process.exit(1); });
