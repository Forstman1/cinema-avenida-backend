# cinema-avenida-backend
Backend API REST du Cinéma Avenida — Express.js + Prisma + PostgreSQL (PFE) : authentification JWT, films, séances, réservations avec verrouillage des sièges, billets QR.

## Vérification de concurrence

Après avoir lancé l'API et obtenu deux tokens CLIENT distincts, envoyer
simultanément deux requêtes `POST /api/reservations/lock` avec le même
`screeningId` et le même `seatId` : une seule doit répondre `201`, l'autre
`409`. Utiliser une séance future et un siège libre, par exemple :

```bash
curl -sS -X POST http://localhost:3000/api/reservations/lock \
  -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" \
  -d '{"screeningId":123,"seatIds":[7]}' &
curl -sS -X POST http://localhost:3000/api/reservations/lock \
  -H "Authorization: Bearer $TOKEN_B" -H "Content-Type: application/json" \
  -d '{"screeningId":123,"seatIds":[7]}' &
wait
```

Cette vérification ne nécessite aucun reset de seed. Supprimer ensuite la
réservation de test via le flux normal de l'application, ou utiliser une base
locale dédiée. Ne jamais lancer un reset destructif avec `NODE_ENV=production`.
