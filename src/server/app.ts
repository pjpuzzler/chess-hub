import { Hono } from 'hono';
import { api } from './routes/api';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { scheduler } from './routes/scheduler';
import { settingsRoutes } from './routes/settings';
import { triggers } from './routes/triggers';

export const app = new Hono();

// Never show stack traces or developer text to users.
app.onError((err, c) => {
  console.error(`${c.req.method} ${c.req.path} failed: ${err}`);
  const message = 'Something went wrong. Try again.';
  return c.req.path.startsWith('/internal/menu') ||
    c.req.path.startsWith('/internal/form')
    ? c.json({ showToast: message }, 200)
    : c.json({ type: 'error', message }, 500);
});
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);
internal.route('/scheduler', scheduler);
internal.route('/settings', settingsRoutes);

app.route('/api', api);
app.route('/internal', internal);
