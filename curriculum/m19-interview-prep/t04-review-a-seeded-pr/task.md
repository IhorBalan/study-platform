A code review round. You are a backend engineer at a small B2B SaaS, and a teammate has asked you to review the pull request below before it merges. **Give yourself 40 minutes.** Review it as you would on GitHub: comments tied to a file and line, each labelled with its severity, then a summary with your verdict.

## The pull request

> **#482 Team invitations**
>
> Team admins can invite people by email. The invitee gets a link and joins the team when they accept. Teams have a seat limit from their plan. Tested manually with Postman; tests will follow in a separate PR.

`AuthGuard` (not in the diff) rejects requests without a valid session and sets `req.user = { id, email }`. The app uses `pg` directly, NestJS 12, and a `memberships` table that already exists.

```diff
diff --git a/migrations/0031_invitations.sql b/migrations/0031_invitations.sql
new file mode 100644
--- /dev/null
+++ b/migrations/0031_invitations.sql
@@ -0,0 +1,10 @@
+CREATE TABLE invitations (
+  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
+  team_id     bigint NOT NULL REFERENCES teams (id),
+  email       text NOT NULL,
+  role        text NOT NULL,
+  token       text NOT NULL,
+  invited_by  bigint NOT NULL REFERENCES users (id),
+  expires_at  timestamptz NOT NULL,
+  accepted_at timestamptz
+);
diff --git a/src/invitations/invitations.controller.ts b/src/invitations/invitations.controller.ts
new file mode 100644
--- /dev/null
+++ b/src/invitations/invitations.controller.ts
@@ -0,0 +1,29 @@
+import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
+import { AuthGuard } from '../auth/auth.guard';
+import { InvitationsService } from './invitations.service';
+
+@Controller()
+@UseGuards(AuthGuard)
+export class InvitationsController {
+  constructor(private readonly invitations: InvitationsService) {}
+
+  @Post('teams/:teamId/invitations')
+  create(@Param('teamId') teamId: string, @Body() body: any, @Req() req) {
+    return this.invitations.invite(teamId, body.email, body.role, req.user.id);
+  }
+
+  @Get('teams/:teamId/invitations')
+  list(@Param('teamId') teamId: string, @Query('search') search?: string) {
+    return this.invitations.listForTeam(teamId, search);
+  }
+
+  @Post('invitations/:token/accept')
+  async accept(@Param('token') token: string, @Req() req) {
+    const result = await this.invitations.accept(token, req.user.id);
+    if (!result.ok) {
+      return { ok: false, reason: result.reason };
+    }
+    return result;
+  }
+}
diff --git a/src/invitations/invitations.service.ts b/src/invitations/invitations.service.ts
new file mode 100644
--- /dev/null
+++ b/src/invitations/invitations.service.ts
@@ -0,0 +1,62 @@
+import { Injectable, Logger } from '@nestjs/common';
+import { Pool } from 'pg';
+import { Mailer } from '../mail/mailer';
+
+const MAIL_API_KEY = 'mk_live_51Hx9f2LqZ7vT0aPp3Kd8RwQe4';
+
+@Injectable()
+export class InvitationsService {
+  private readonly logger = new Logger(InvitationsService.name);
+  private readonly mailer = new Mailer(MAIL_API_KEY);
+
+  constructor(private readonly db: Pool) {}
+
+  async invite(teamId: string, email: string, role: string, invitedBy: string) {
+    const token = Math.random().toString(36).slice(2);
+    const { rows } = await this.db.query(
+      `INSERT INTO invitations (team_id, email, role, token, invited_by, expires_at)
+       VALUES ($1, $2, $3, $4, $5, now() + interval '7 days') RETURNING *`,
+      [teamId, email, role, token, invitedBy],
+    );
+    this.logger.log(`Invited ${email} to team ${teamId} with token ${token}`);
+    this.mailer.send(email, 'You are invited', `Join here: https://app.example.com/join/${token}`);
+    return rows[0];
+  }
+
+  async listForTeam(teamId: string, search?: string) {
+    let sql = 'SELECT * FROM invitations WHERE team_id = $1';
+    if (search) sql += ` AND email LIKE '%${search}%'`;
+    const { rows } = await this.db.query(sql, [teamId]);
+    for (const invitation of rows) {
+      const inviter = await this.db.query('SELECT id, name, email FROM users WHERE id = $1', [
+        invitation.invited_by,
+      ]);
+      invitation.inviter = inviter.rows[0];
+    }
+    return rows;
+  }
+
+  async accept(token: string, userId: string) {
+    const { rows } = await this.db.query('SELECT * FROM invitations WHERE token = $1', [token]);
+    const invitation = rows[0];
+    if (!invitation) return { ok: false, reason: 'not-found' };
+    if (invitation.accepted_at) return { ok: false, reason: 'already-accepted' };
+    if (invitation.expires_at < new Date()) return { ok: false, reason: 'expired' };
+
+    const seats = await this.db.query(
+      `SELECT t.seat_limit, (SELECT count(*) FROM memberships m WHERE m.team_id = t.id)::int AS used
+         FROM teams t WHERE t.id = $1`,
+      [invitation.team_id],
+    );
+    if (seats.rows[0].used >= seats.rows[0].seat_limit) return { ok: false, reason: 'no-seats' };
+
+    await this.db.query('INSERT INTO memberships (team_id, user_id, role) VALUES ($1, $2, $3)', [
+      invitation.team_id,
+      userId,
+      invitation.role,
+    ]);
+    await this.db.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [invitation.id]);
+    return { ok: true, teamId: invitation.team_id };
+  }
+}
```

## What to write

1. **Review comments,** most severe first. For each: the file and line, a label (`issue (blocking)`, `suggestion`, `question`, `nitpick`), the problem, its concrete consequence, and a fix (a sentence or a few lines of code).
2. **What is missing** from the PR, not only what is wrong in it.
3. **A summary** as you would post it: verdict, the blocking issues as a list, and one thing done well.

There are more than eight problems of different kinds in this diff. You will be scored on finding the important ones, ordering them by severity, and on how a teammate would receive your comments. There are no automated checks.
