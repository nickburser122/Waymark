import { serve } from './browser.mjs';

const { url } = await serve(Number(process.env.PORT || 8080));
console.log(`Waymark is served at ${url}`);
