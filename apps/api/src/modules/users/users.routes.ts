import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { getAuth, requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import {
  changeRoleSchema,
  createMemberSchema,
  userIdParam,
  type ChangeRoleInput,
  type CreateMemberInput,
} from './users.schemas';
import { changeMemberRole, createMember, listMembers } from './users.service';

export const usersRouter = Router();

usersRouter.use(requireAuth, requireStore, requireRole('OWNER'));

usersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ items: await listMembers(getStore(res).storeId) });
  }),
);

usersRouter.post(
  '/',
  validateBody(createMemberSchema),
  asyncHandler(async (req, res) => {
    const member = await createMember(getStore(res).storeId, req.body as CreateMemberInput);
    res.status(201).json(member);
  }),
);

usersRouter.patch(
  '/:userId/role',
  validateBody(changeRoleSchema),
  asyncHandler(async (req, res) => {
    const targetUserId = userIdParam.parse(req.params.userId);
    const { role } = req.body as ChangeRoleInput;
    const result = await changeMemberRole(
      getStore(res).storeId,
      getAuth(res).user.id,
      targetUserId,
      role,
    );
    res.json(result);
  }),
);
