-- Contato opcional do usuário. Login continua por username/senha.
-- Contas existentes ficam com email NULL (válido; UNIQUE no PostgreSQL permite vários NULL).

ALTER TABLE "User" ADD COLUMN "email" TEXT;

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
