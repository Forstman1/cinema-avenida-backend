// Seed : 120 sièges (10 rangées x 12), 3 films, 3 séances de test
// Lancer avec : npm run seed
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const prisma = new PrismaClient();

function categorieDe(rangee) {
  if (["A", "B", "C"].includes(rangee)) return "CLUB";
  if (["D", "E", "F", "G"].includes(rangee)) return "NORMAL";
  return "VIP"; // H, I, J
}

async function main() {
  // 1. Sièges : 10 rangées (A-J) x 12 sièges
  const rangees = "ABCDEFGHIJ".split("");
  for (const r of rangees) {
    for (let n = 1; n <= 12; n++) {
      await prisma.seat.upsert({
        where: { rangee_numero: { rangee: r, numero: n } },
        update: {},
        create: { rangee: r, numero: n, categorie: categorieDe(r) },
      });
    }
  }
  console.log("120 sièges créés (Club: A-C, Normal: D-G, VIP: H-J)");

  // 2. Admin de test
  await prisma.user.upsert({
    where: { email: "admin@avenida.ma" },
    update: {},
    create: {
      nom: "Admin Avenida",
      email: "admin@avenida.ma",
      motDePasse: await bcrypt.hash("admin123", 10),
      role: "ADMIN",
    },
  });

  // 3. Trois films de test
  const films = [
    { titre: "Dune : Deuxième Partie", synopsis: "Paul Atreides s'unit à Chani et aux Fremen...", duree: 166, genre: "Science-Fiction" },
    { titre: "Le Silence des Étoiles", synopsis: "Un explorateur solitaire découvre un artefact ancien...", duree: 135, genre: "Science-Fiction" },
    { titre: "Minuit à Paris", synopsis: "Un écrivain voyage dans le temps chaque nuit...", duree: 94, genre: "Comédie" },
  ];
  const aujourdhui = new Date();
  for (const [i, f] of films.entries()) {
    const movie = await prisma.movie.create({ data: f });
    await prisma.screening.create({
      data: { date: aujourdhui, horaire: ["18:00", "20:30", "22:30"][i], movieId: movie.id },
    });
  }
  console.log("3 films + 3 séances créés");
}

main().finally(() => prisma.$disconnect());
