/**
 * Company details shown on the About, Contact, Careers, Press and legal pages.
 * TBVault is a demo project, so these are placeholder values: the domain uses
 * .example (reserved, never a real address) and the phone number is fake.
 * The admin "store email" / "store address" settings override email and address
 * where they're set (see useCompany below).
 */
import { useStoreConfig } from '../features/store/useStoreConfig';

export const COMPANY = {
  name: 'TBVault',
  legalName: 'TBVault Commerce (Pvt) Ltd',
  founded: 2024,
  email: 'support@tbvault.example',
  careersEmail: 'careers@tbvault.example',
  pressEmail: 'press@tbvault.example',
  privacyEmail: 'privacy@tbvault.example',
  phone: '+92 21 000 0000',
  hours: 'Monday to Saturday, 10am to 7pm (PKT)',
  address: ['Floor 7, 21 Harbour Street', 'Karachi 75600', 'Pakistan'],
  lastUpdated: 'October 2026',
};

/** COMPANY with the store's own email/address settings applied when an admin has set them. */
export const useCompany = () => {
  const config = useStoreConfig();
  return {
    ...COMPANY,
    email: config?.store_email || COMPANY.email,
    address: config?.store_address ? config.store_address.split(/\n|,\s*/) : COMPANY.address,
    storeName: config?.store_name || COMPANY.name,
  };
};
