// Visual asset slots (SPEC-050 24.3). A null slot makes the UI fall back to text and gradients.

export type AssetSlot = { readonly src: string; readonly alt: string };

export const assets: { readonly logo: AssetSlot | null; readonly keyVisual: AssetSlot | null } = {
  logo: null,
  keyVisual: null,
};
