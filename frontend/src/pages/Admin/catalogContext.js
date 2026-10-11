import { createContext, useContext } from 'react';
import { adminCatalog } from '../../api/catalog.api';

/**
 * Which product API the shared product screens talk to. The admin dashboard uses the
 * default; the seller dashboard wraps them in <CatalogApiContext.Provider value={sellerCatalog}>.
 */
export const CatalogApiContext = createContext(adminCatalog);
export const useCatalogApi = () => useContext(CatalogApiContext);
