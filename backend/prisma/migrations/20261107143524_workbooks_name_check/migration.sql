-- name_key is lower-cased by the API (JavaScript toLowerCase). PostgreSQL's lower() is
-- locale-dependent and can differ for some Unicode characters, so the check only requires
-- non-empty values instead of comparing the two.
ALTER TABLE "workbooks" DROP CONSTRAINT "workbooks_name_key_check";
ALTER TABLE "workbooks" ADD CONSTRAINT "workbooks_name_key_check"
  CHECK (length(trim("name")) > 0 AND length("name_key") > 0);
