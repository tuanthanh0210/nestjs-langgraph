import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export function createCurrentTimeTool(defaultTimezone: string) {
  return tool(
    async ({ timezone }) => {
      const tz = timezone?.trim() || defaultTimezone;

      try {
        const now = new Date();
        const formatted = new Intl.DateTimeFormat('en-GB', {
          timeZone: tz,
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'short',
        }).format(now);

        return JSON.stringify({
          timezone: tz,
          iso: now.toISOString(),
          local: formatted,
          epochMs: now.getTime(),
        });
      } catch {
        return `Invalid timezone "${tz}". Use an IANA time zone such as "Asia/Ho_Chi_Minh" or "UTC".`;
      }
    },
    {
      name: 'current_time',
      description:
        'Get the current date and time in a specific IANA time zone. ' +
        'Always use this tool when the user asks for the current time or date.',
      schema: z.object({
        timezone: z
          .string()
          .optional()
          .describe(
            'IANA time zone, e.g. "Asia/Ho_Chi_Minh", "Europe/London", "America/New_York". Defaults to the server time zone.',
          ),
      }),
    },
  );
}
