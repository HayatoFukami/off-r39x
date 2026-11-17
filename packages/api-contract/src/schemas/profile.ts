import { z } from "zod";

export const principalNavigationSchema = z.strictObject({
  profile_ref: z.uuid(),
  capabilities: z.array(z.string()),
  has_staff_role: z.boolean(),
  has_administrator_role: z.boolean(),
});
export type PrincipalNavigation = z.infer<typeof principalNavigationSchema>;
