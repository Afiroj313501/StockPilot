import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateTemporaryPassword } from '../src/utils/password';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run admin:reset-password -w @stockpilot/api -- user@example.com');
    process.exitCode = 1;
    return;
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error('No account has that email address.');
      process.exitCode = 1;
      return;
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: true },
      }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);
    console.log(`Temporary password for ${email}: ${temporaryPassword}`);
    console.log('It is shown only now. They must choose a new password at the next sign-in.');
    if (!user.isActive)
      console.log(
        'Note: this account is deactivated; reactivate it from the Users page before it can sign in.',
      );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
