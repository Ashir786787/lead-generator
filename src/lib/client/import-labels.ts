import type { ImportField } from "@/lib/import/mapping";

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: "Business name",
  category: "Category",
  website: "Website",
  phone: "Phone",
  email: "Email",
  street: "Street address",
  area: "Area / district",
  city: "City",
  country: "Country",
  lat: "Latitude",
  lng: "Longitude",
  sourceId: "Source ID",
};
