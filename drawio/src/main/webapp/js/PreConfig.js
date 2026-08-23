/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// Overrides of global vars need to be pre-loaded
window.DRAWIO_PUBLIC_BUILD = true;
window.EXPORT_URL = 'REPLACE_WITH_YOUR_IMAGE_SERVER';
window.DRAWIO_BASE_URL = '.';
window.DRAWIO_VIEWER_URL = null;
window.DRAWIO_LIGHTBOX_URL = null;
window.DRAW_MATH_URL = 'math4/es5';
window.DRAWIO_CONFIG = null;
urlParams['sync'] = 'manual';

// Force Japanese Language by default
window.mxLanguage = 'ja';
window.mxDefaultLanguage = 'ja';
urlParams['lang'] = 'ja';

// Google Drive Integration Defaults
window.DRAWIO_GOOGLE_APP_ID = window.DRAWIO_GOOGLE_APP_ID || '671128082532';
window.DRAWIO_GOOGLE_CLIENT_ID = window.DRAWIO_GOOGLE_CLIENT_ID || '671128082532-jhphbq6d0e1gnsus9mn7vf8a6fjn10mp.apps.googleusercontent.com';
