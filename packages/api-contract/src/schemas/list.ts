import { z } from "zod";

/** SPEC-110 section 48.3: the common page query, exactly as specified. */
export const pageQuery = {
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(512).optional(),
};

const RESERVED = ["limit", "cursor", "sort", "order_by", "offset", "page"];

/**
 * Fixed, strict query schema of one list Operation (API-QRY-001/002). Sort modes are enums the
 * Operation defines in `shape`; arbitrary sort, column, offset and page names are refused here.
 */
export function listQuerySchema<S extends z.ZodRawShape>(shape: S) {
  for (const name of Object.keys(shape)) {
    if (RESERVED.includes(name)) throw new Error(`List query shape must not define "${name}"`);
  }
  return z.strictObject({ ...shape, ...pageQuery });
}

/** SPEC-110 section 12 / 19: `data` of a list response. */
export const listDataSchema = <T extends z.ZodType>(item: T) =>
  z
    .strictObject({
      items: z.array(item).max(100),
      page: z.strictObject({
        next_cursor: z.string().min(1).max(512).nullable(),
        has_more: z.boolean(),
      }),
    })
    .refine((data) => data.page.has_more === (data.page.next_cursor !== null));

export type ListData<T extends z.ZodType> = z.infer<ReturnType<typeof listDataSchema<T>>>;
