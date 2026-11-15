import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Modal } from '../components/ui/Modal';
import { SelectField } from '../components/ui/SelectField';
import { TextField } from '../components/ui/TextField';
import { useMe } from '../features/auth/hooks';
import {
  useChangeRole,
  useCreateUser,
  useResetPassword,
  useSetUserActive,
  useUsers,
} from '../features/users/hooks';
import { ApiError } from '../lib/api';
import { generatePassword } from '../lib/password';
import type { Member, Role } from '../types/api';

const ROLE_LABEL: Record<Role, string> = { OWNER: 'Owner', MANAGER: 'Manager', CASHIER: 'Cashier' };
const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';

export function UsersPage() {
  const me = useMe();
  const users = useUsers();
  const create = useCreateUser();
  const changeRole = useChangeRole();
  const active = useSetUserActive();
  const reset = useResetPassword();
  const [adding, setAdding] = useState(false);
  const [roleFor, setRoleFor] = useState<Member | null>(null);
  const [confirm, setConfirm] = useState<Member | null>(null);
  const [resetFor, setResetFor] = useState<Member | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    role: 'CASHIER' as 'MANAGER' | 'CASHIER',
    password: generatePassword(),
    requirePasswordChange: true,
  });
  const myId = me.data?.user.id;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    create.mutate(form, {
      onSuccess: () => {
        setAdding(false);
        setSecret(form.password);
        setForm({ ...form, name: '', email: '', password: generatePassword() });
      },
    });
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-navy-900">Users</h1>
        <Button onClick={() => setAdding(true)}>Add user</Button>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Manage staff accounts, roles, access, and forgotten passwords.
      </p>
      {users.isPending ? (
        <p className="mt-6 text-slate-500">Loading users...</p>
      ) : users.isError ? (
        <p role="alert" className="mt-6 text-red-700">
          Could not load users.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.data.map((user) => {
                const protectedRow = user.role === 'OWNER' || user.userId === myId;
                return (
                  <tr
                    key={user.userId}
                    className={user.isActive ? '' : 'bg-slate-50 text-slate-500'}
                  >
                    <td className="px-4 py-3 font-medium">
                      {user.name}
                      {user.userId === myId && <span className="ml-2 text-xs">(you)</span>}
                    </td>
                    <td className="px-4 py-3">{user.email}</td>
                    <td className="px-4 py-3">{ROLE_LABEL[user.role]}</td>
                    <td className="px-4 py-3">
                      {user.isActive ? 'Active' : 'Deactivated'}
                      {user.mustChangePassword && (
                        <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                          Must change password
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {protectedRow ? (
                        '—'
                      ) : (
                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            className="text-blue-600 hover:underline"
                            onClick={() => setRoleFor(user)}
                          >
                            Change role
                          </button>
                          <button
                            type="button"
                            className="text-blue-600 hover:underline"
                            onClick={() => setResetFor(user)}
                          >
                            Reset password
                          </button>
                          <button
                            type="button"
                            className="text-blue-600 hover:underline"
                            onClick={() => setConfirm(user)}
                          >
                            {user.isActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add user">
        <form onSubmit={submit} className="space-y-4">
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <SelectField
            label="Role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as 'MANAGER' | 'CASHIER' })}
          >
            <option value="CASHIER">Cashier</option>
            <option value="MANAGER">Manager</option>
          </SelectField>
          <TextField
            label="Initial password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={10}
          />
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.requirePasswordChange}
              onChange={(e) => setForm({ ...form, requirePasswordChange: e.target.checked })}
            />{' '}
            Require password change at first sign-in
          </label>
          {create.isError && (
            <p role="alert" className="text-sm text-red-700">
              {errorMessage(create.error)}
            </p>
          )}
          <Button type="submit" loading={create.isPending}>
            Create user
          </Button>
        </form>
      </Modal>
      <Modal open={secret !== null} onClose={() => setSecret(null)} title="Temporary password">
        <div className="space-y-4">
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            This password is shown only once. Give it to the user through a trusted channel.
          </p>
          <code className="block rounded bg-slate-100 p-3 font-mono">{secret}</code>
          <Button onClick={() => setSecret(null)}>Done</Button>
        </div>
      </Modal>
      <Modal open={roleFor !== null} onClose={() => setRoleFor(null)} title="Change role">
        {roleFor && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const role = (e.currentTarget.elements.namedItem('role') as HTMLSelectElement)
                .value as 'MANAGER' | 'CASHIER';
              changeRole.mutate(
                { userId: roleFor.userId, role },
                { onSuccess: () => setRoleFor(null) },
              );
            }}
          >
            <SelectField
              name="role"
              label={`Role for ${roleFor.name}`}
              defaultValue={roleFor.role === 'MANAGER' ? 'MANAGER' : 'CASHIER'}
            >
              <option value="CASHIER">Cashier</option>
              <option value="MANAGER">Manager</option>
            </SelectField>
            <Button type="submit" loading={changeRole.isPending}>
              Save role
            </Button>
          </form>
        )}
      </Modal>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.isActive ? 'Deactivate this user?' : 'Reactivate this user?'}
        message={
          confirm?.isActive
            ? `${confirm.name} will be signed out everywhere and blocked from signing in.`
            : `${confirm?.name ?? 'This user'} will be able to sign in again.`
        }
        confirmLabel={confirm?.isActive ? 'Deactivate' : 'Reactivate'}
        loading={active.isPending}
        error={active.isError ? errorMessage(active.error) : null}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm)
            active.mutate(
              { userId: confirm.userId, isActive: !confirm.isActive },
              { onSuccess: () => setConfirm(null) },
            );
        }}
      />
      <ConfirmDialog
        open={resetFor !== null}
        title="Reset this password?"
        message={`${resetFor?.name ?? 'This user'} will be signed out everywhere and must choose a new password.`}
        confirmLabel="Reset password"
        loading={reset.isPending}
        error={reset.isError ? errorMessage(reset.error) : null}
        onCancel={() => setResetFor(null)}
        onConfirm={() => {
          if (resetFor)
            reset.mutate(resetFor.userId, {
              onSuccess: (result) => {
                setResetFor(null);
                setSecret(result.temporaryPassword);
              },
            });
        }}
      />
    </div>
  );
}
