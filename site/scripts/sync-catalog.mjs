// PHP reads the same catalog as the site, so the endpoints and the confirmation emails never disagree with the pages.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCatalog } from '../src/lib/catalog-data.mjs';

writeFileSync(resolve('public/api/catalog.json'), JSON.stringify(loadCatalog(), null, 2) + '\n');
console.log('catalog synced to public/api/catalog.json');
