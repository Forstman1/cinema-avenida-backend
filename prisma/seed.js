const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const prisma = new PrismaClient();
const CINEMA_TIMEZONE = process.env.CINEMA_TIMEZONE || "Africa/Casablanca";
const SEED_RESET = process.env.SEED_RESET === "true";

const SEAT_PRICES = { CLUB: 45, NORMAL: 60, VIP: 90 };

const MOVIE_DATA = [
  {
    title: "Dune : Deuxième Partie",
    synopsis: "Paul Atréides rejoint Chani et les Fremen pour mener la révolte contre les Harkonnen et accomplir un destin qui dépasse les frontières d'Arrakis.",
    duration: 166,
    genre: "Science-fiction",
    poster: "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=900&q=80",
  },
  {
    title: "Oppenheimer",
    synopsis: "Le physicien J. Robert Oppenheimer dirige le projet Manhattan et affronte les conséquences scientifiques, politiques et morales de son invention.",
    duration: 180,
    genre: "Drame historique",
    poster: "https://images.unsplash.com/photo-1534791547706-7b64b042fbe8?auto=format&fit=crop&w=900&q=80",
  },
  {
    title: "Spider-Man : Across the Spider-Verse",
    synopsis: "Miles Morales traverse de nouveaux univers et rencontre une équipe de Spider-People dont les choix mettent son monde et ses proches en danger.",
    duration: 140,
    genre: "Animation",
    poster: "https://images.unsplash.com/photo-1635805737707-575885ab0820?auto=format&fit=crop&w=900&q=80",
  },
  {
    title: "Interstellar",
    synopsis: "Une équipe d'explorateurs franchit un passage près de Saturne pour trouver une nouvelle planète habitable et offrir un avenir à l'humanité.",
    duration: 169,
    genre: "Science-fiction",
    poster: "https://images.unsplash.com/photo-1446776877081-d282a0f896e2?auto=format&fit=crop&w=900&q=80",
  },
  {
    title: "Parasite",
    synopsis: "Une famille sans ressources s'immisce peu à peu dans le quotidien d'une riche famille de Séoul, jusqu'à ce qu'un secret bouleverse leur fragile équilibre.",
    duration: 132,
    genre: "Thriller dramatique",
    poster: "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=900&q=80",
  },
  {
    title: "Le Comte de Monte-Cristo",
    synopsis: "Après une trahison qui lui vole treize années de liberté, Edmond Dantès revient sous une nouvelle identité pour préparer une vengeance patiente et spectaculaire.",
    duration: 178,
    genre: "Aventure historique",
    poster: "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=900&q=80",
  },
  {
    title: "Film à venir la semaine prochaine",
    synopsis: "Une jeune architecte découvre dans les plans d'un immeuble abandonné la trace d'une histoire familiale qu'elle croyait définitivement oubliée.",
    duration: 108,
    genre: "Drame",
    poster: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=80",
  },
  {
    title: "Film terminé",
    synopsis: "Dans une ville côtière, un ancien gardien de phare tente de réparer les liens brisés avec sa fille avant la dernière tempête de la saison.",
    duration: 116,
    genre: "Drame familial",
    poster: "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=900&q=80",
  },
  {
    title: "Film sans programmation",
    synopsis: "Une restauratrice de tableaux reçoit une œuvre anonyme dont les détails semblent annoncer des événements qui ne se sont pas encore produits.",
    duration: 124,
    genre: "Mystère",
    poster: "https://images.unsplash.com/photo-1549490349-8643362247b5?auto=format&fit=crop&w=900&q=80",
  },
];

const SEEDED_MOVIE_TITLES = MOVIE_DATA.map((movie) => movie.title);
const CINEMA_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: CINEMA_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function cinemaParts(date) {
  return Object.fromEntries(
    CINEMA_DATE_FORMATTER.formatToParts(date).map(({ type, value }) => [type, value])
  );
}

function cinemaDateKey(date) {
  const parts = cinemaParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function storedCalendarDateKey(date) {
  return date.toISOString().slice(0, 10);
}

// Convert numeric date parts to UTC midnight; never parse a YYYY-MM-DD string.
function dateKeyToDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function startOfCinemaWeek(date) {
  const monday = dateKeyToDate(cinemaDateKey(date));
  const weekday = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return monday;
}

function seatKey(row, number) {
  return `${row}${number}`;
}

function sameIds(left, right) {
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

async function resetSeededData() {
  const seededMovies = await prisma.movie.findMany({
    where: { title: { in: SEEDED_MOVIE_TITLES } },
    select: { id: true },
  });
  const movieIds = seededMovies.map((movie) => movie.id);
  if (movieIds.length === 0) return;

  const seededScreenings = await prisma.screening.findMany({
    where: { movieId: { in: movieIds } },
    select: { id: true },
  });
  const screeningIds = seededScreenings.map((screening) => screening.id);
  if (screeningIds.length === 0) {
    await prisma.movie.deleteMany({ where: { id: { in: movieIds } } });
    return;
  }

  const seededReservations = await prisma.reservation.findMany({
    where: { screeningId: { in: screeningIds } },
    select: { id: true },
  });
  const reservationIds = seededReservations.map((reservation) => reservation.id);

  await prisma.$transaction(async (tx) => {
    if (reservationIds.length > 0) {
      await tx.ticket.deleteMany({ where: { reservationId: { in: reservationIds } } });
      await tx.reservationSeat.deleteMany({ where: { reservationId: { in: reservationIds } } });
      await tx.reservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    await tx.screening.deleteMany({ where: { id: { in: screeningIds } } });
    await tx.movie.deleteMany({ where: { id: { in: movieIds } } });
  });
}

async function ensureUser({ name, email, password, role }) {
  const hashedPassword = await bcrypt.hash(password, 10);
  return prisma.user.upsert({
    where: { email },
    update: { name, password: hashedPassword, role },
    create: { name, email, password: hashedPassword, role },
  });
}

async function ensureMovie(movieData) {
  const existing = await prisma.movie.findFirst({
    where: { title: movieData.title },
    orderBy: { id: "asc" },
  });
  if (!existing) return prisma.movie.create({ data: movieData });

  // Repair only the old local seed's example.com posters. Preserve other
  // existing records, including movies edited or created by an administrator.
  if (existing.poster && existing.poster.includes("example.com")) {
    return prisma.movie.update({ where: { id: existing.id }, data: movieData });
  }
  return existing;
}

async function ensureScreening(movieId, dateKey, showTime) {
  return prisma.screening.upsert({
    where: { movieId_date_showTime: { movieId, date: dateKeyToDate(dateKey), showTime } },
    update: {},
    create: { movieId, date: dateKeyToDate(dateKey), showTime },
  });
}

async function ensureReservation({ userId, screeningId, seatIds, status, lockedUntil, totalAmount }) {
  const candidates = await prisma.reservation.findMany({
    where: { userId, screeningId },
    include: { reservationSeats: true },
    orderBy: { id: "asc" },
  });
  let reservation = candidates.find((candidate) =>
    sameIds(candidate.reservationSeats.map((item) => item.seatId), seatIds)
  );

  if (!reservation) {
    reservation = await prisma.reservation.create({
      data: {
        userId,
        screeningId,
        totalAmount,
        status,
        reservationSeats: { create: seatIds.map((seatId) => ({ seatId, lockedUntil })) },
      },
      include: { reservationSeats: true },
    });
  } else {
    reservation = await prisma.reservation.update({
      where: { id: reservation.id },
      data: { totalAmount, status },
      include: { reservationSeats: true },
    });
    await prisma.reservationSeat.updateMany({
      where: { reservationId: reservation.id },
      data: { lockedUntil },
    });
  }
  return reservation;
}

async function ensureTicket(reservationId, status) {
  const existing = await prisma.ticket.findUnique({ where: { reservationId } });
  if (existing) {
    return prisma.ticket.update({ where: { id: existing.id }, data: { status } });
  }
  return prisma.ticket.create({ data: { reservationId, qrCode: crypto.randomUUID(), status } });
}

async function ensureNoFixtureTicket(reservationId) {
  const ticket = await prisma.ticket.findUnique({ where: { reservationId } });
  if (ticket) {
    throw new Error(
      `Le fixture en attente #${reservationId} possède déjà un billet; utilisez SEED_RESET=true pour le restaurer.`
    );
  }
}

async function main() {
  if (SEED_RESET && process.env.NODE_ENV === "production") {
    throw new Error("SEED_RESET=true est interdit lorsque NODE_ENV=production.");
  }
  if (SEED_RESET) {
    console.warn("⚠️  MODE RESET ACTIF : les données liées aux films du seed seront supprimées.");
    await resetSeededData();
  }
  console.log("🌱 Début du seeding Cinema Avenida...");

  const rows = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  const categoryByRow = {
    A: "CLUB", B: "CLUB", C: "CLUB",
    D: "NORMAL", E: "NORMAL", F: "NORMAL", G: "NORMAL",
    H: "VIP", I: "VIP", J: "VIP",
  };
  for (const row of rows) {
    for (let number = 1; number <= 12; number += 1) {
      await prisma.seat.upsert({
        where: { row_number: { row, number } },
        update: { category: categoryByRow[row] },
        create: { row, number, category: categoryByRow[row] },
      });
    }
  }

  const users = {
    admin: await ensureUser({ name: "Administrateur", email: "admin@avenida.ma", password: "admin123", role: "ADMIN" }),
    client1: await ensureUser({ name: "Client 1", email: "client1@avenida.ma", password: "client123", role: "CLIENT" }),
    client2: await ensureUser({ name: "Client 2", email: "client2@avenida.ma", password: "client123", role: "CLIENT" }),
  };

  const movies = {};
  for (const movieData of MOVIE_DATA) movies[movieData.title] = await ensureMovie(movieData);

  const now = new Date();
  const monday = startOfCinemaWeek(now);
  const todayKey = cinemaDateKey(now);
  const todayOffset = Math.round((dateKeyToDate(todayKey).getTime() - monday.getTime()) / 86400000);
  const tomorrowKey = storedCalendarDateKey(addDays(dateKeyToDate(todayKey), 1));
  const nextMonday = addDays(monday, 7);
  const nextMondayKey = storedCalendarDateKey(nextMonday);
  const nextWeekOnlyKey = storedCalendarDateKey(addDays(nextMonday, 2));
  const emptyFutureKey = storedCalendarDateKey(addDays(nextMonday, 6));
  const recentDateKey = storedCalendarDateKey(addDays(monday, -7));
  const recentDuneDateKey = storedCalendarDateKey(addDays(monday, -6));

  const screeningByKey = new Map();
  const requestedSchedule = [];
  const addRequestedScreening = (title, dateKey, showTime) => {
    const key = `${dateKey}|${showTime}`;
    if (requestedSchedule.some((item) => `${item.dateKey}|${item.showTime}` === key)) {
      throw new Error(`Chevauchement de séance demandé le ${dateKey} à ${showTime}.`);
    }
    requestedSchedule.push({ title, dateKey, showTime });
  };

  addRequestedScreening("Dune : Deuxième Partie", todayKey, "18:00");
  addRequestedScreening("Oppenheimer", todayKey, "20:30");
  addRequestedScreening("Spider-Man : Across the Spider-Verse", todayKey, "22:30");
  addRequestedScreening("Interstellar", tomorrowKey, "18:00");
  addRequestedScreening("Parasite", tomorrowKey, "20:30");

  const laterMovieSets = [
    ["Le Comte de Monte-Cristo"], [],
    ["Dune : Deuxième Partie", "Oppenheimer"],
    ["Spider-Man : Across the Spider-Verse", "Interstellar", "Parasite"],
    ["Le Comte de Monte-Cristo"],
  ];
  for (let index = 0; index < laterMovieSets.length; index += 1) {
    const offset = todayOffset + 2 + index;
    if (offset > 6) break;
    const showTimes = ["18:00", "20:30", "22:30"];
    laterMovieSets[index].forEach((title, movieIndex) => {
      addRequestedScreening(title, storedCalendarDateKey(addDays(monday, offset)), showTimes[movieIndex]);
    });
  }

  addRequestedScreening("Film terminé", recentDateKey, "18:00");
  addRequestedScreening("Le Comte de Monte-Cristo", recentDateKey, "20:30");
  addRequestedScreening("Dune : Deuxième Partie", recentDuneDateKey, "18:00");
  addRequestedScreening("Dune : Deuxième Partie", nextMondayKey, "16:00");
  addRequestedScreening("Film à venir la semaine prochaine", nextWeekOnlyKey, "20:30");

  for (const item of requestedSchedule) {
    const screening = await ensureScreening(movies[item.title].id, item.dateKey, item.showTime);
    screeningByKey.set(`${item.title}|${item.dateKey}|${item.showTime}`, screening);
  }

  const seatRecords = await prisma.seat.findMany({ orderBy: [{ row: "asc" }, { number: "asc" }] });
  const seatsByKey = new Map(seatRecords.map((seat) => [seatKey(seat.row, seat.number), seat]));
  const seatIdsFor = (keys) => {
    const seats = keys.map((key) => seatsByKey.get(key));
    if (seats.some((seat) => !seat)) throw new Error(`Siège introuvable: ${keys.join(", ")}`);
    return seats.map((seat) => seat.id);
  };
  const amountFor = (keys) => keys.reduce((sum, key) => sum + SEAT_PRICES[seatsByKey.get(key).category], 0);

  const fixture = {};
  const currentScreening = screeningByKey.get(`Dune : Deuxième Partie|${todayKey}|18:00`);
  const cancellableScreening = screeningByKey.get(`Interstellar|${tomorrowKey}|18:00`);
  const activePendingScreening = screeningByKey.get(`Parasite|${tomorrowKey}|20:30`);
  const expiredPendingScreening = screeningByKey.get(`Spider-Man : Across the Spider-Verse|${todayKey}|22:30`);
  const cancelledScreening = screeningByKey.get(`Film terminé|${recentDateKey}|18:00`);
  const soldOutScreening = screeningByKey.get(`Dune : Deuxième Partie|${nextMondayKey}|16:00`);

  const confirmedSeats = ["A1", "D1", "H1"];
  fixture.confirmed = await ensureReservation({ userId: users.client1.id, screeningId: currentScreening.id, seatIds: seatIdsFor(confirmedSeats), status: "CONFIRMED", lockedUntil: null, totalAmount: amountFor(confirmedSeats) });
  fixture.confirmedTicket = await ensureTicket(fixture.confirmed.id, "VALID");

  const cancellableSeats = ["A2", "D2", "H2"];
  fixture.cancellable = await ensureReservation({ userId: users.client1.id, screeningId: cancellableScreening.id, seatIds: seatIdsFor(cancellableSeats), status: "CONFIRMED", lockedUntil: null, totalAmount: amountFor(cancellableSeats) });
  fixture.cancellableTicket = await ensureTicket(fixture.cancellable.id, "VALID");

  const activePendingSeats = ["B1", "E1", "I1"];
  const activePendingSeatIds = seatIdsFor(activePendingSeats);
  const activePendingFixtures = await prisma.reservation.findMany({
    where: { userId: users.client2.id, screeningId: activePendingScreening.id },
    include: { reservationSeats: true },
    orderBy: { id: "asc" },
  });
  const activePendingFixture = activePendingFixtures.find((reservation) => sameIds(reservation.reservationSeats.map((item) => item.seatId), activePendingSeatIds));
  if (activePendingFixture && sameIds(activePendingFixture.reservationSeats.map((item) => item.seatId), activePendingSeatIds)) {
    await ensureNoFixtureTicket(activePendingFixture.id);
  }
  fixture.activePending = await ensureReservation({ userId: users.client2.id, screeningId: activePendingScreening.id, seatIds: seatIdsFor(activePendingSeats), status: "EN_ATTENTE", lockedUntil: new Date(Date.now() + 10 * 60 * 1000), totalAmount: amountFor(activePendingSeats) });

  const expiredPendingSeats = ["B2", "E2", "I2"];
  const expiredPendingSeatIds = seatIdsFor(expiredPendingSeats);
  const expiredPendingFixtures = await prisma.reservation.findMany({
    where: { userId: users.client2.id, screeningId: expiredPendingScreening.id },
    include: { reservationSeats: true },
    orderBy: { id: "asc" },
  });
  const expiredPendingFixture = expiredPendingFixtures.find((reservation) => sameIds(reservation.reservationSeats.map((item) => item.seatId), expiredPendingSeatIds));
  if (expiredPendingFixture && sameIds(expiredPendingFixture.reservationSeats.map((item) => item.seatId), expiredPendingSeatIds)) {
    await ensureNoFixtureTicket(expiredPendingFixture.id);
  }
  fixture.expiredPending = await ensureReservation({ userId: users.client2.id, screeningId: expiredPendingScreening.id, seatIds: seatIdsFor(expiredPendingSeats), status: "EN_ATTENTE", lockedUntil: new Date(Date.now() - 10 * 60 * 1000), totalAmount: amountFor(expiredPendingSeats) });

  const cancelledSeats = ["C1", "F1", "J1"];
  fixture.cancelled = await ensureReservation({ userId: users.client2.id, screeningId: cancelledScreening.id, seatIds: seatIdsFor(cancelledSeats), status: "CANCELLED", lockedUntil: null, totalAmount: amountFor(cancelledSeats) });
  fixture.cancelledTicket = await ensureTicket(fixture.cancelled.id, "CANCELLED");

  const soldOutSeatKeys = seatRecords.map((seat) => seatKey(seat.row, seat.number));
  fixture.soldOut = await ensureReservation({ userId: users.client2.id, screeningId: soldOutScreening.id, seatIds: soldOutSeatKeys.map((key) => seatsByKey.get(key).id), status: "CONFIRMED", lockedUntil: null, totalAmount: amountFor(soldOutSeatKeys) });
  fixture.soldOutTicket = await ensureTicket(fixture.soldOut.id, "VALID");

  await validateSeed({ users, movies, fixture, seatRecords, todayKey, monday, nextMondayKey, emptyFutureKey, soldOutScreening });
  await printSummary({ users, movies, fixture, todayKey, todayOffset, monday, nextMondayKey, emptyFutureKey });
}

async function validateSeed({ users, movies, fixture, seatRecords, todayKey, monday, nextMondayKey, emptyFutureKey, soldOutScreening }) {
  const failures = [];
  const expect = (condition, message) => { if (!condition) failures.push(message); };
  expect(seatRecords.length === 120, `120 sièges attendus, obtenu ${seatRecords.length}`);
  const categoryCounts = seatRecords.reduce((counts, seat) => { counts[seat.category] = (counts[seat.category] || 0) + 1; return counts; }, {});
  expect(categoryCounts.CLUB === 36, "36 sièges CLUB attendus");
  expect(categoryCounts.NORMAL === 48, "48 sièges NORMAL attendus");
  expect(categoryCounts.VIP === 36, "36 sièges VIP attendus");
  for (const email of ["admin@avenida.ma", "client1@avenida.ma", "client2@avenida.ma"]) {
    expect(Boolean(Object.values(users).find((user) => user.email === email)), `Utilisateur absent: ${email}`);
  }
  for (const title of SEEDED_MOVIE_TITLES) expect(Boolean(movies[title]), `Film absent: ${title}`);

  const allScreenings = await prisma.screening.findMany({ include: { movie: true }, orderBy: [{ date: "asc" }, { showTime: "asc" }, { id: "asc" }] });
  const uniqueCompositeKeys = new Set(allScreenings.map((screening) => `${screening.movieId}|${storedCalendarDateKey(screening.date)}|${screening.showTime}`));
  expect(uniqueCompositeKeys.size === allScreenings.length, "Des doublons de (movieId, date, showTime) existent");
  const timeKeys = new Set();
  for (const screening of allScreenings) {
    const key = `${storedCalendarDateKey(screening.date)}|${screening.showTime}`;
    expect(!timeKeys.has(key), `Chevauchement le ${key} dans l'auditorium unique`);
    timeKeys.add(key);
    expect(/^([01]\d|2[0-3]):[0-5]\d$/.test(screening.showTime), `Heure invalide: ${screening.showTime}`);
  }
  expect(allScreenings.some((screening) => storedCalendarDateKey(screening.date) === todayKey), "Aucune séance le jour courant");
  expect(allScreenings.some((screening) => storedCalendarDateKey(screening.date) > todayKey), "Aucune séance sur un jour futur");

  const screeningsByDate = new Map();
  for (const screening of allScreenings) {
    const key = storedCalendarDateKey(screening.date);
    screeningsByDate.set(key, (screeningsByDate.get(key) || 0) + 1);
  }
  expect(!screeningsByDate.has(emptyFutureKey), `La date future ${emptyFutureKey} doit être vide`);
  expect([...screeningsByDate.values()].some((count) => count === 1), "Aucune date ne comporte exactement une séance");

  const movieScreenings = await prisma.screening.findMany({ where: { movieId: { in: Object.values(movies).map((movie) => movie.id) } }, orderBy: { date: "asc" } });
  const screeningsFor = (title) => movieScreenings.filter((screening) => screening.movieId === movies[title].id);
  const duneDates = new Set(screeningsFor("Dune : Deuxième Partie").map((screening) => storedCalendarDateKey(screening.date)));
  expect(duneDates.size >= 2, "Un film doit être programmé sur plusieurs dates");
  expect(screeningsFor("Film terminé").length > 0 && screeningsFor("Film terminé").every((screening) => storedCalendarDateKey(screening.date) < todayKey), "Film terminé doit avoir uniquement des séances passées");
  expect(screeningsFor("Film à venir la semaine prochaine").length > 0 && screeningsFor("Film à venir la semaine prochaine").every((screening) => storedCalendarDateKey(screening.date) >= nextMondayKey), "Film à venir doit avoir uniquement des séances de la semaine prochaine");
  expect(screeningsFor("Film sans programmation").length === 0, "Film sans programmation ne doit avoir aucune séance");

  for (const [reservation, amount, message] of [
    [fixture.confirmed, 195, "Réservation confirmée invalide"],
    [fixture.cancellable, 195, "Réservation annulable invalide"],
    [fixture.activePending, 195, "Réservation en attente active invalide"],
    [fixture.expiredPending, 195, "Réservation en attente expirée invalide"],
    [fixture.cancelled, 195, "Réservation annulée invalide"],
  ]) expect(reservation.totalAmount === amount, message);
  expect(fixture.confirmed.status === "CONFIRMED", "Fixture confirmée invalide");
  expect(fixture.cancellable.status === "CONFIRMED", "Fixture annulable invalide");
  expect(fixture.activePending.status === "EN_ATTENTE", "Fixture active invalide");
  expect(fixture.expiredPending.status === "EN_ATTENTE", "Fixture expirée invalide");
  expect(fixture.cancelled.status === "CANCELLED", "Fixture annulée invalide");

  const soldOutSeats = await prisma.reservationSeat.count({ where: { reservationId: fixture.soldOut.id } });
  expect(soldOutSeats === 120, `La réservation sold-out doit contenir 120 sièges (obtenu ${soldOutSeats})`);
  expect(fixture.soldOut.totalAmount === 7740, "Total sold-out attendu: 7740 DH");
  const tickets = await prisma.ticket.findMany({ select: { qrCode: true } });
  expect(new Set(tickets.map((ticket) => ticket.qrCode)).size === tickets.length, "Les valeurs QR ne sont pas toutes uniques");
  const activeLocks = await prisma.reservationSeat.findMany({ where: { reservationId: fixture.activePending.id } });
  const expiredLocks = await prisma.reservationSeat.findMany({ where: { reservationId: fixture.expiredPending.id } });
  expect(activeLocks.length > 0 && activeLocks.every((seat) => seat.lockedUntil > new Date()), "Le verrou actif doit expirer dans le futur");
  expect(expiredLocks.length > 0 && expiredLocks.every((seat) => seat.lockedUntil < new Date()), "Le verrou expiré doit être dans le passé");
  expect(allScreenings.some((screening) => storedCalendarDateKey(screening.date) >= storedCalendarDateKey(monday) && storedCalendarDateKey(screening.date) < storedCalendarDateKey(addDays(monday, 7))), "Aucune séance dans la semaine courante");
  expect(Boolean(soldOutScreening), "Séance sold-out introuvable");
  if (failures.length > 0) throw new Error(`Validation du seed échouée:\n- ${failures.join("\n- ")}`);
  console.log("✅ Validation du seed réussie: sièges, programme, réservations et billets cohérents.");
}

async function printSummary({ users, movies, fixture, todayKey, todayOffset, monday, nextMondayKey, emptyFutureKey }) {
  const movieIds = Object.values(movies).map((movie) => movie.id);
  const screenings = await prisma.screening.findMany({
    where: { movieId: { in: movieIds } },
    include: { movie: { select: { title: true } } },
    orderBy: [{ date: "asc" }, { showTime: "asc" }, { id: "asc" }],
  });
  const reservations = [
    ["confirmée du jour", fixture.confirmed], ["annulable future", fixture.cancellable],
    ["attente active", fixture.activePending], ["attente expirée", fixture.expiredPending],
    ["historique annulée", fixture.cancelled], ["sold-out", fixture.soldOut],
  ];
  console.log("\n📋 Résumé des fixtures (dates cinéma: lundi à dimanche)");
  console.log(`Dates: semaine courante ${storedCalendarDateKey(monday)} → ${storedCalendarDateKey(addDays(monday, 6))}; aujourd'hui ${todayKey}`);
  console.log(`Date future vide: ${emptyFutureKey}; semaine suivante à partir du ${nextMondayKey}`);
  if (todayOffset === 6) {
    console.log("Note: aujourd'hui est dimanche; la date vide est placée la semaine suivante car il ne reste aucun jour dans la semaine courante.");
  }
  console.log("\nUtilisateurs:");
  for (const user of Object.values(users)) console.log(`- ${user.email} (${user.role})`);
  console.log("\nFilms:");
  for (const movie of Object.values(movies).sort((a, b) => a.id - b.id)) console.log(`- ${movie.title} (#${movie.id})`);
  console.log(`\nSéances: ${screenings.length}`);
  let previousDate = null;
  for (const screening of screenings) {
    const date = storedCalendarDateKey(screening.date);
    if (date !== previousDate) { console.log(`  ${date}:`); previousDate = date; }
    console.log(`    ${screening.showTime} — ${screening.movie.title} (#${screening.id})`);
  }
  console.log("\nRéservations et billets:");
  for (const [label, reservation] of reservations) {
    const ticket = await prisma.ticket.findUnique({ where: { reservationId: reservation.id }, select: { id: true } });
    console.log(`- ${label}: réservation #${reservation.id} (${reservation.status}), ticket ${ticket ? `#${ticket.id}` : "aucun"}`);
  }
  const soldOut = await prisma.reservation.findUnique({ where: { id: fixture.soldOut.id }, select: { screeningId: true } });
  console.log(`\nID séance sold-out: #${soldOut.screeningId}`);
  console.log(`IDs Postman: séance du jour #${fixture.confirmed.screeningId}, séance annulable #${fixture.cancellable.screeningId}, séance attente #${fixture.activePending.screeningId}`);
  console.log("✅ Seed terminé sans doublons.");
}

main()
  .catch((error) => {
    console.error("❌ Erreur pendant le seeding:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
