CREATE TABLE "item_property_terms" (
	"tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"value" text,
	CONSTRAINT "item_property_terms_kind_check" CHECK ("item_property_terms"."kind" in ('tag', 'string', 'array'))
);
--> statement-breakpoint
ALTER TABLE "item_property_terms" ADD CONSTRAINT "item_property_terms_tenant_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_property_terms_null_unique" ON "item_property_terms" USING btree ("tenant_id","item_id","key","kind") WHERE "item_property_terms"."value" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "item_property_terms_value_unique" ON "item_property_terms" USING btree ("tenant_id","item_id","key","kind","value") WHERE "item_property_terms"."value" is not null;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM items
    WHERE jsonb_typeof(items.properties) IS DISTINCT FROM 'object'
  ) OR EXISTS (
    SELECT 1
    FROM items
    CROSS JOIN LATERAL jsonb_each(items.properties) AS property(key, value)
    WHERE jsonb_typeof(property.value) NOT IN ('null', 'string', 'number', 'boolean', 'array')
      OR (
        jsonb_typeof(property.value) = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(property.value) AS member(value)
          WHERE jsonb_typeof(member.value) NOT IN ('string', 'number', 'boolean')
        )
      )
  ) THEN
    RAISE EXCEPTION 'Unsupported legacy property shape prevents item_property_terms migration';
  END IF;
END;
$$;--> statement-breakpoint
WITH property_values AS (
  SELECT items.tenant_id,
         items.id AS item_id,
         property.key,
         property.value,
         jsonb_typeof(property.value) AS property_kind
  FROM items
  CROSS JOIN LATERAL jsonb_each(items.properties) AS property(key, value)
), normalized_values AS (
  SELECT tenant_id,
         item_id,
         key,
         CASE property_kind
           WHEN 'null' THEN value
           WHEN 'string' THEN CASE WHEN value #>> '{}' = '' THEN NULL ELSE value END
           WHEN 'number' THEN to_jsonb(value #>> '{}')
           WHEN 'boolean' THEN to_jsonb(value #>> '{}')
           WHEN 'array' THEN (
             SELECT jsonb_agg(to_jsonb(deduplicated.value) ORDER BY deduplicated.first_ordinal)
             FROM (
               SELECT member.value #>> '{}' AS value,
                      min(member.ordinality) AS first_ordinal
               FROM jsonb_array_elements(property_values.value)
                    WITH ORDINALITY AS member(value, ordinality)
               WHERE member.value #>> '{}' <> ''
               GROUP BY member.value #>> '{}'
             ) deduplicated
           )
         END AS normalized_value
  FROM property_values
), normalized_properties AS (
  SELECT tenant_id,
         item_id,
         coalesce(
           jsonb_object_agg(key, normalized_value ORDER BY key)
             FILTER (WHERE normalized_value IS NOT NULL),
           '{}'::jsonb
         ) AS properties
  FROM normalized_values
  GROUP BY tenant_id, item_id
)
UPDATE items
SET properties = normalized_properties.properties
FROM normalized_properties
WHERE items.tenant_id = normalized_properties.tenant_id
  AND items.id = normalized_properties.item_id
  AND items.properties IS DISTINCT FROM normalized_properties.properties;--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_item_property_terms()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM item_property_terms
  WHERE tenant_id = NEW.tenant_id AND item_id = NEW.id;

  IF NEW.status <> 'ready' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.properties) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Unexpected properties shape for item %', NEW.id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_each(NEW.properties) AS property(key, value)
    WHERE jsonb_typeof(property.value) NOT IN ('null', 'string', 'array')
      OR (
        jsonb_typeof(property.value) = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(property.value) AS member(value)
          WHERE jsonb_typeof(member.value) <> 'string'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected property kind for item %', NEW.id;
  END IF;

  INSERT INTO item_property_terms (tenant_id, item_id, key, kind, value)
  SELECT NEW.tenant_id, NEW.id, property.key, 'tag', NULL::text
  FROM jsonb_each(NEW.properties) AS property(key, value)
  WHERE jsonb_typeof(property.value) = 'null'
  UNION ALL
  SELECT NEW.tenant_id, NEW.id, property.key, 'string', property.value #>> '{}'
  FROM jsonb_each(NEW.properties) AS property(key, value)
  WHERE jsonb_typeof(property.value) = 'string'
  UNION ALL
  SELECT NEW.tenant_id, NEW.id, property.key, 'array', member.value
  FROM jsonb_each(NEW.properties) AS property(key, value)
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(property.value) = 'array' THEN property.value
      ELSE '[]'::jsonb
    END
  ) AS member(value)
  WHERE jsonb_typeof(property.value) = 'array';

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER items_sync_item_property_terms
AFTER INSERT OR UPDATE OF status, properties ON items
FOR EACH ROW
EXECUTE FUNCTION sync_item_property_terms();--> statement-breakpoint
WITH expanded AS (
  SELECT items.tenant_id,
         items.id AS item_id,
         property.key,
         property.value,
         jsonb_typeof(property.value) AS property_kind
  FROM items
  CROSS JOIN LATERAL jsonb_each(items.properties) AS property(key, value)
  WHERE items.status = 'ready'
), terms AS (
  SELECT tenant_id, item_id, key, 'tag'::text AS kind, NULL::text AS value
  FROM expanded
  WHERE property_kind = 'null'
  UNION ALL
  SELECT tenant_id, item_id, key, 'string'::text AS kind, value #>> '{}' AS value
  FROM expanded
  WHERE property_kind = 'string'
  UNION ALL
  SELECT expanded.tenant_id,
         expanded.item_id,
         expanded.key,
         'array'::text AS kind,
         member.value
  FROM expanded
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN expanded.property_kind = 'array' THEN expanded.value
      ELSE '[]'::jsonb
    END
  ) AS member(value)
  WHERE expanded.property_kind = 'array'
)
INSERT INTO item_property_terms (tenant_id, item_id, key, kind, value)
SELECT tenant_id, item_id, key, kind, value
FROM terms
ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE INDEX "item_property_terms_tenant_item_idx" ON "item_property_terms" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "item_property_terms_tenant_key_idx" ON "item_property_terms" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "item_property_terms_tenant_key_value_idx" ON "item_property_terms" USING btree ("tenant_id","key","value") WHERE "item_property_terms"."value" is not null;--> statement-breakpoint
CREATE INDEX "item_property_terms_key_trgm_idx" ON "item_property_terms" USING gin ("key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "item_property_terms_value_trgm_idx" ON "item_property_terms" USING gin ("value" gin_trgm_ops) WHERE "item_property_terms"."value" is not null;
