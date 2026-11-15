# User management

## The owner (Users page)

- **Add user**: name, email, role (Manager or Cashier), and an initial password. By default, the user must choose a new password at first sign-in.
- **Change role**: Manager or Cashier. Owners cannot be created or changed through the app.
- **Deactivate**: signs the person out everywhere and blocks sign-in. Their sales and history remain. Reactivate restores access.
- **Reset password**: creates a random 16-character temporary password shown once. All sessions end and the user must choose a new password at sign-in.
- You cannot deactivate or reset yourself, or change another owner.

## Everyone (My account)

- Change your name; earlier audit entries keep the old name.
- Change your password by entering the current one. Other sessions end. There are 10 attempts per 15 minutes.

## What the server enforces

- While a password change is required, only `/auth/me` and `/auth/change-password` are available; other requests return `PASSWORD_CHANGE_REQUIRED`.
- Passwords are stored only as bcrypt hashes. Temporary passwords are never stored or logged; the audit log records only that a reset happened.

## Recovering an owner account (operator)

Run this on the server:

    npm run admin:reset-password -w @stockpilot/api -- owner@example.com

The temporary password is printed once, sessions end, and a new password is required at the next sign-in. Keep server and database access restricted.

## Limits

There is no email reset or verification, password history, breached-password check, or “sign out everywhere” button. A user belongs to one store; the active flag is per user.
