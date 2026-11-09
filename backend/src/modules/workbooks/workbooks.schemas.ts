import { z } from 'zod';

/** Characters Excel/Windows do not allow in file names, plus control characters. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
export const FORBIDDEN_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/;

export const workbookNameSchema = z
  .string({ error: 'Workbook name is required' })
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'Workbook name is required')
      .max(100, 'Workbook name must be at most 100 characters')
      .refine(
        (value) => !FORBIDDEN_NAME_CHARS.test(value),
        'Workbook name cannot contain \\ / : * ? " < > | or control characters',
      ),
  );

export const createWorkbookSchema = z.strictObject({
  name: workbookNameSchema,
  /** Make the new workbook the default (the first workbook always becomes the default). */
  makeDefault: z.boolean().optional(),
});

export const renameWorkbookSchema = z.strictObject({
  name: workbookNameSchema,
  /** Version the client last saw; the rename fails with 409 if the workbook changed since. */
  version: z.number({ error: 'Version is required' }).int().min(1),
});

export const deleteWorkbookQuerySchema = z.object({
  version: z.coerce.number().int().min(1).optional(),
});

export const workbookIdParamSchema = z.uuid('Invalid workbook ID');

export type CreateWorkbookInput = z.infer<typeof createWorkbookSchema>;
export type RenameWorkbookInput = z.infer<typeof renameWorkbookSchema>;
export type DeleteWorkbookQuery = z.infer<typeof deleteWorkbookQuerySchema>;

/** Case-insensitive uniqueness key of a workbook name. */
export function workbookNameKey(name: string): string {
  return name.toLowerCase();
}
