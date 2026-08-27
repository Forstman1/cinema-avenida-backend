-- Do not silently resolve existing conflicts. The migration must be stopped so
-- an operator can choose which screening to keep or reschedule.
DO $$
DECLARE
  duplicate_slots TEXT;
BEGIN
  SELECT string_agg(
    format('%s à %s (%s séances)', calendar_date, "showTime", duplicate_count),
    ', ' ORDER BY calendar_date, "showTime"
  )
  INTO duplicate_slots
  FROM (
    SELECT
      ("date"::date) AS calendar_date,
      "showTime",
      COUNT(*) AS duplicate_count
    FROM "Screening"
    GROUP BY ("date"::date), "showTime"
    HAVING COUNT(*) > 1
  ) AS duplicates;

  IF duplicate_slots IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration interrompue : doublons de créneau détectés (%). Corrigez les données manuellement puis relancez la migration.',
      duplicate_slots;
  END IF;
END $$;

DROP INDEX "Screening_movieId_date_showTime_key";

CREATE UNIQUE INDEX "Screening_date_showTime_key"
  ON "Screening"("date", "showTime");
