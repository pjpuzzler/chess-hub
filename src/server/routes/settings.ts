import { Hono } from 'hono';
import type {
  SettingsValidationRequest,
  SettingsValidationResponse,
} from '@devvit/web/shared';

export const settingsRoutes = new Hono();

settingsRoutes.post('/validate-hour', async (c) => {
  const { value } = await c.req.json<SettingsValidationRequest<number>>();
  const ok =
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 23;
  return c.json<SettingsValidationResponse>(
    ok
      ? { success: true }
      : { success: false, error: 'Enter a whole number from 0 to 23.' }
  );
});
