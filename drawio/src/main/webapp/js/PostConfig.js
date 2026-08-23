/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// null'ing of global vars need to be after init.js
window.ICONSEARCH_PATH = null;
window.ICON_SERVICE_PATH = null;

// Load AI Assistant plugin
if (typeof mxscript === 'function')
{
	mxscript('js/aiAssistant.js');
}
else
{
	var s = document.createElement('script');
	s.src = 'js/aiAssistant.js';
	document.head.appendChild(s);
}

