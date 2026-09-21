const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();
(async () => {
  const hash = await bcrypt.hash("test123", 10);
  const u = await prisma.user.create({ data: { username: "tmpvfy_x", name: "Verify", password: hash, role: "ADMIN", active: true } });
  console.log("USER", u.id);
  await prisma.$disconnect();
})();
