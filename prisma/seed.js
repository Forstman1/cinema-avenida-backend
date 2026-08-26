const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

function todayAtMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  console.log("🌱 Début du seeding...");

  // 1. Création des 120 sièges (A-J × 12)
  const rows = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  const categoryByRow = {
    A: "CLUB",
    B: "CLUB",
    C: "CLUB",
    D: "NORMAL",
    E: "NORMAL",
    F: "NORMAL",
    G: "NORMAL",
    H: "VIP",
    I: "VIP",
    J: "VIP",
  };

  for (const row of rows) {
    for (let num = 1; num <= 12; num++) {
      await prisma.seat.upsert({
        where: { row_number: { row, number: num } },
        update: {},
        create: {
          row,
          number: num,
          category: categoryByRow[row],
        },
      });
    }
  }
  console.log("✅ 120 sièges créés/mis à jour");

  // 2. Création de l'administrateur
  const adminPassword = await bcrypt.hash("admin123", 10);
  await prisma.user.upsert({
    where: { email: "admin@avenida.ma" },
    update: {},
    create: {
      name: "Administrateur",
      email: "admin@avenida.ma",
      password: adminPassword,
      role: "ADMIN",
    },
  });
  console.log("✅ Administrateur créé : admin@avenida.ma / admin123");

  // 3. Création de 3 films
  const movies = [
    {
      title: "Dune : Deuxième Partie",
      synopsis:
        "Paul Atreides s'allie à Chani et aux Fremen pour mener la révolte contre ceux qui ont détruit sa famille.",
      duration: 166,
      genre: "Science-Fiction",
      poster: "https://example.com/dune2.jpg",
    },
    {
      title: "Oppenheimer",
      synopsis:
        "L'histoire du scientifique J. Robert Oppenheimer et de son rôle dans le développement de la bombe atomique.",
      duration: 180,
      genre: "Drame historique",
      poster: "https://example.com/oppenheimer.jpg",
    },
    {
      title: "Spider-Man : Across the Spider-Verse",
      synopsis:
        "Miles Morales traverse le multivers pour sauver ses proches et découvre de nouveaux Spider-People.",
      duration: 140,
      genre: "Animation",
      poster: "https://example.com/spiderverse.jpg",
    },
  ];

  for (let i = 0; i < movies.length; i++) {
    const movie = movies[i];
    const created = await prisma.movie.upsert({
      where: { id: i + 1 },
      update: {},
      create: movie,
    });

    // Une séance par film à 18:00, 20:30 et 22:30
    const showTimes = [
      { h: 18, m: 0 },
      { h: 20, m: 30 },
      { h: 22, m: 30 },
    ];

    const screeningDate = todayAtMidnight();

    for (const { h, m } of showTimes) {
      const showTimeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      await prisma.screening.upsert({
        where: {
          movieId_date_showTime: {
            movieId: created.id,
            date: screeningDate,
            showTime: showTimeStr,
          },
        },
        update: {},
        create: {
          date: screeningDate,
          showTime: showTimeStr,
          movieId: created.id,
        },
      });
    }
    console.log(`✅ Film + séances créés : ${movie.title}`);
  }

  console.log("🎉 Seeding terminé avec succès !");
}

main()
  .catch((e) => {
    console.error("❌ Erreur pendant le seeding :", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
