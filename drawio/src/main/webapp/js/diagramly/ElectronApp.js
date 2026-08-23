/**
 * Copyright (c) 2020-2025, JGraph Holdings Ltd
 * Copyright (c) 2020-2025, draw.io AG
 */
window.PLUGINS_BASE_PATH = '.';
window.TEMPLATE_PATH = 'templates';
window.DRAW_MATH_URL = 'math4/es5';
window.DRAWIO_BASE_URL = '.'; //Prevent access to online website since it is not allowed
window.DRAWIO_SERVER_URL = '.';
EditorUi.draftSaveDelay = 5000;
//Disables eval for JS (uses shapes-14-6-5.min.js)
mxStencilRegistry.allowEval = false;

(async function()
{
	let requestSync = async function(msg)
	{
		if (typeof msg === 'string')
		{
			msg = {
				action: msg
			};
		}

		async function doRequest()
		{
			return new Promise((resolve, reject) => {
				electron.request(msg, function(data)
				{
					resolve(data);
				}, function(errMsg, e)
				{
					reject(e || errMsg);
				});
			});
		};

		return await doRequest();
	};
	
	// Overrides default mode
	App.mode = App.MODE_DEVICE;
	
	// Automatic sync on conflicts
	Editor.desktopAutoSync = true;

	// Recovers drawio XML from PDFs where pdf-lib 2.6.0+ wrote the
	// hex-encoded /Subject as a top-level indirect object instead of
	// inside /ObjStm [jgraph/drawio-desktop#2394]
	var origExtractGraphModelFromPdf = Editor.extractGraphModelFromPdf;

	Editor.extractGraphModelFromPdf = function(base64)
	{
		var result = origExtractGraphModelFromPdf.apply(this, arguments);

		if (result != null)
		{
			return result;
		}

		try
		{
			var data = base64.substring(base64.indexOf(',') + 1);
			var f = (window.atob && !mxClient.IS_SF) ? atob(data) : Base64.decode(data, true);

			// UTF-16-BE encoding of BOM + '%3Cmxfile' (URL-encoded '<mxfile')
			var anchor = 'FEFF002500330043006D007800660069006C0065';
			var pos = 0;

			while ((pos = f.indexOf('/Subject <', pos)) > -1)
			{
				var hexStart = pos + 10;
				var hexEnd = f.indexOf('>', hexStart);

				if (hexEnd < 0)
				{
					break;
				}

				var hex = f.substring(hexStart, hexEnd).replace(/\s/g, '').toUpperCase();

				if (hex.indexOf(anchor) === 0)
				{
					var decoded = '';

					// Skip FEFF BOM, decode UTF-16-BE code units
					for (var i = 4; i + 4 <= hex.length; i += 4)
					{
						decoded += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
					}

					var xml = decodeURIComponent(decoded.
						replace(/\\\(/g, '(').replace(/\\\)/g, ')'));

					if (xml.indexOf('<mxfile') === 0)
					{
						return xml;
					}
				}

				pos = hexEnd;
			}
		}
		catch (e)
		{
			// Fall through to null
		}

		return null;
	};

	// Disables all external transmission functionality
	App.prototype.isExternalDataComms = function()
	{
		return false;
	};
	
	// Disables preview option in embed dialog
	EmbedDialog.showPreviewOption = false;

	// Disables new window option in edit diagram dialog
	EditDiagramDialog.showNewWindowOption = false;

	PrintDialog.previewEnabled = false;

	// Adds PDF with embedded XML as an editable file format (PDF export
	// and re-save run through the local Electron export pipeline)
	Editor.prototype.diagramFileTypes = Editor.prototype.diagramFileTypes.concat(
		[{description: 'formatPdf', extension: 'pdf', mimeType: 'application/pdf'}]);

	PrintDialog.electronPrint = function(editorUi, args)
	{
		var graph = editorUi.editor.graph;
		var file = editorUi.getCurrentFile();

		if (file)
		{
			file.updateFileData();
		}

		var xml = editorUi.getFileData(true, null, null, null,
			!args.selection, false, null, null, null, false, true);
		
		var extras = {globalVars: graph.getExportVariables()};

		if (Graph.translateDiagram)
		{
			extras.diagramLanguage = Graph.diagramLanguage;
		}

		if (args.grid)
		{
			extras.grid = {
				size: graph.gridSize,
				steps: graph.view.gridSteps,
				color: graph.view.gridColor
			};
		}

		// Passes hidden tags per page to export backend
		var hiddenTagsMap = editorUi.getHiddenTagsMap();

		if (hiddenTagsMap != null)
		{
			extras.hiddenTags = hiddenTagsMap;
		}

		new mxElectronRequest('export', {
			fileTitle: editorUi.getBaseFilename(true),
			print: true,
			format: 'pdf',
			xml: xml,
			from: args.pagesFrom - 1,
			to: args.pagesTo - 1,
			allPages: args.allPages ? '1' : '0',
			pageWidth: graph.pageFormat.width,
			pageHeight: graph.pageFormat.height,
			// Rendered pages span pageFormat * pageScale to match the editor's
			// page breaks; the main process maps each rendered page onto one
			// physical sheet via scaleFactor = 100 / pageScale. A hardcoded 1
			// here printed the page cuts of an unscaled page grid
			// [jgraph/drawio#5540]
			pageScale: graph.pageScale,
			fit: args.fit ? '1' : '0',
			sheetsAcross: args.sheetsAcross,
			sheetsDown: args.sheetsDown,
			scale: args.scale,
			extras: JSON.stringify(extras),
			border: null,
			pageMargin: args.border,
			crop: args.crop ? '1' : '0'
		}).send(function(){}, function(){});
	};
	
	var oldWindowOpen = window.open;
	window.open = async function(url)
	{
		// Only open a native electron window when url is empty. We use this in our code in several places.
		if (url == null)
		{
			return oldWindowOpen(url);
		}
		else
		{
			// Open external will filter urls based on their protocol
			await requestSync({action: 'openExternal', url: url});
		}
	}

	var origAppMain = App.main;
	
	App.main = async function()
	{
		// Set AutoSave delay
		var draftSaveDelay = mxSettings.getDraftSaveDelay();
		
		if (draftSaveDelay != null)
		{
			EditorUi.draftSaveDelay = draftSaveDelay * 1000;
			EditorUi.enableDrafts = draftSaveDelay > 0;
		}

		//Load desktop plugins
		var plugins = (mxSettings.settings != null) ? mxSettings.getPlugins() : null;
		App.initPluginCallback();

		if (plugins != null && plugins.length > 0)
		{
			// Workaround for body not defined if plugins are used in dev mode
			if (urlParams['dev'] == '1')
			{
				EditorUi.debug('App.main', 'Skipped plugins', plugins);
			}
			else
			{
				for (var i = 0; i < plugins.length; i++)
				{
					try
					{
						// Resolved into a local variable as plugins is the live settings
						// array and rewritten entries would be persisted on the next
						// settings save, breaking resolution on the following start
						var pluginUrl = plugins[i];

						if (pluginUrl.indexOf('..') >= 0)
						{
							continue;
						}
						else if (pluginUrl.startsWith('/plugins/'))
						{
							pluginUrl = '.' + pluginUrl;
						}
						else if (pluginUrl.startsWith('plugins/'))
						{
							pluginUrl = './' + pluginUrl;
						}

						// Only built-in plugins shipped with the app are supported;
						// settings entries for the removed external plugins are skipped
						if (!pluginUrl.startsWith('./plugins/'))
						{
							continue;
						}

						mxscript(pluginUrl);
					}
					catch (e)
					{
						// ignore
					}
				}
			}
		}
		
		//Remove old relaxed CSP and add strict one
		var allMeta = document.getElementsByTagName('meta');

		for (var i = 0; i < allMeta.length; i++)
		{
			if (allMeta[i].getAttribute('http-equiv') == 'Content-Security-Policy')
			{
				allMeta[i].parentNode.removeChild(allMeta[i]);
			}

			break;
		}

		mxmeta(null, 'default-src \'self\'; connect-src \'self\' https://generativelanguage.googleapis.com https://api.openai.com https://api.anthropic.com http://localhost:11434 http://127.0.0.1:11434 https://fonts.googleapis.com https://fonts.gstatic.com; img-src * data:; ' +
			'media-src *; font-src * data:; frame-src \'self\'; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com', 'Content-Security-Policy');

		//Disable web plugins loading
		urlParams['plugins'] = '0';
		origAppMain.apply(this, arguments);
	};

	var editorCongigure = Editor.configure;
	Editor.configure = function(config)
	{
		editorCongigure.apply(this, arguments);

		if (config != null)
		{
			if (config.desktopAutoSync != null)
			{
				Editor.desktopAutoSync = config.desktopAutoSync;
			}

			if (Editor.enableLocalFonts)
			{
				requestSync({action: 'getLocalFonts'}).then(function(fonts)
				{
					if (fonts != null && fonts.length > 0)
					{
						Editor.localFonts = fonts;

						if (config.defaultFonts == null &&
							config.customFonts == null)
						{
							Menus.prototype.defaultFonts = fonts;
						}
					}
				}).catch(function()
				{
					// Ignore errors from font enumeration
				});
			}
		}
	};
	
	// Intercept all AI requests in renderer to route through Electron Node.js backend (bypasses CORS status 0 errors)
	var origMxXmlRequestSend = mxXmlRequest.prototype.send;
	mxXmlRequest.prototype.send = function(onload, onerror, timeout, ontimeout)
	{
		var self = this;
		if (this.url && (this.url.indexOf('generativelanguage.googleapis.com') >= 0 ||
			this.url.indexOf('api.openai.com') >= 0 ||
			this.url.indexOf('api.anthropic.com') >= 0 ||
			this.url.indexOf('localhost:11434') >= 0 ||
			this.url.indexOf('127.0.0.1:11434') >= 0))
		{
			var headers = {};
			var mockReq = {
				setRequestHeader: function(k, v) { headers[k] = v; }
			};
			if (typeof this.setRequestHeaders === 'function')
			{
				this.setRequestHeaders(mockReq, this.params);
			}

			var provider = 'gemini';
			if (this.url.indexOf('api.openai.com') >= 0) provider = 'openai';
			else if (this.url.indexOf('api.anthropic.com') >= 0) provider = 'claude';
			else if (this.url.indexOf('11434') >= 0) provider = 'ollama';

			var modelMatch = this.url.match(/models\/([^:]+):generateContent/);
			var modelName = modelMatch ? modelMatch[1] : '';

			var apiKey = headers['X-Goog-Api-Key'] || headers['x-goog-api-key'] || headers['X-API-Key'] ||
				(headers['Authorization'] ? headers['Authorization'].replace('Bearer ', '') : '');
			if (!apiKey)
			{
				var keyMatch = this.url.match(/key=([^&]+)/);
				if (keyMatch) apiKey = keyMatch[1];
			}

			var parsedParams = null;
			try { parsedParams = JSON.parse(this.params); } catch(e) {}

			var userPrompt = '';
			var sysPrompt = '';

			if (parsedParams)
			{
				if (parsedParams.contents && parsedParams.contents[0] && parsedParams.contents[0].parts)
				{
					userPrompt = parsedParams.contents[0].parts.map(function(p) { return p.text || ''; }).join('\n');
				}
				if (parsedParams.system_instruction && parsedParams.system_instruction.parts)
				{
					sysPrompt = parsedParams.system_instruction.parts.map(function(p) { return p.text || ''; }).join('\n');
				}
				if (parsedParams.messages)
				{
					for (var i = 0; i < parsedParams.messages.length; i++)
					{
						if (parsedParams.messages[i].role === 'system') sysPrompt = parsedParams.messages[i].content;
						else if (parsedParams.messages[i].role === 'user') userPrompt = parsedParams.messages[i].content;
					}
				}
			}

			electron.request({
				action: 'aiRequest',
				provider: provider,
				apiKey: apiKey,
				model: modelName,
				endpoint: this.url,
				systemPrompt: sysPrompt,
				userPrompt: userPrompt
			}, function(res)
			{
				var textContent = (res && res.text) ? res.text : (typeof res === 'string' ? res : '');
				var mockJson = {};

				if (provider === 'gemini')
				{
					mockJson = {
						candidates: [{
							content: {
								parts: [{ text: textContent }]
							}
						}]
					};
				}
				else if (provider === 'claude')
				{
					mockJson = {
						content: [{ text: textContent }]
					};
				}
				else
				{
					mockJson = {
						choices: [{
							message: { content: textContent }
						}]
					};
				}

				var mockReqObj = {
					getStatus: function() { return 200; },
					getText: function() { return JSON.stringify(mockJson); },
					getXml: function() { return null; }
				};

				if (typeof onload === 'function')
				{
					onload(mockReqObj);
				}
			}, function(errMsg, err)
			{
				var mockReqObj = {
					getStatus: function() { return 500; },
					getText: function() { return JSON.stringify({ error: { message: errMsg || (err && err.message) || '通信エラー' } }); }
				};
				if (typeof onerror === 'function')
				{
					onerror(mockReqObj);
				}
				else if (typeof onload === 'function')
				{
					onload(mockReqObj);
				}
			});
			return;
		}

		origMxXmlRequestSend.apply(this, arguments);
	};

	Editor.aiModels = [
		{name: 'Gemini 3.6 Flash', model: 'gemini-3.6-flash', config: 'gemini'},
		{name: 'Gemini 2.5 Flash', model: 'gemini-2.5-flash', config: 'gemini'},
		{name: 'Gemini 2.5 Pro', model: 'gemini-2.5-pro', config: 'gemini'},
		{name: 'Gemini 2.0 Flash', model: 'gemini-2.0-flash', config: 'gemini'},
		{name: 'Gemini 1.5 Flash', model: 'gemini-1.5-flash', config: 'gemini'},
		{name: 'GPT-4o (OpenAI)', model: 'gpt-4o', config: 'gpt'},
		{name: 'GPT-4o-mini', model: 'gpt-4o-mini', config: 'gpt'},
		{name: 'Claude 3.7 Sonnet', model: 'claude-3-7-sonnet-20250219', config: 'claude'},
		{name: 'Claude 3.5 Sonnet', model: 'claude-3-5-sonnet-20241022', config: 'claude'}
	];

	// Global AI Engine for draw.io Desktop
	window.drawioAi = (function()
	{
		function callAiBackend(req)
		{
			return new Promise(function(resolve, reject)
			{
				if (typeof electron === 'undefined' || !electron.request)
				{
					reject(new Error('Electron IPCが利用できません。'));
					return;
				}

				electron.request(Object.assign({ action: 'aiRequest' }, req), function(res)
				{
					if (res && res.text) resolve(res.text);
					else resolve(res);
				}, function(errMsg, err)
				{
					reject(new Error(errMsg || (err && err.message) || 'AIリクエストに失敗しました。'));
				});
			});
		}

		function getAiConfig()
		{
			return new Promise(function(resolve)
			{
				if (typeof electron === 'undefined' || !electron.request)
				{
					resolve({});
					return;
				}

				electron.request({ action: 'getAiConfig' }, function(res)
				{
					resolve(res || {});
				}, function()
				{
					resolve({});
				});
			});
		}

		function saveAiConfig(cfg)
		{
			return new Promise(function(resolve, reject)
			{
				if (typeof electron === 'undefined' || !electron.request)
				{
					reject(new Error('Electron IPCが利用できません。'));
					return;
				}

				electron.request({ action: 'saveAiConfig', config: cfg }, function(res)
				{
					resolve(res);
				}, function(errMsg)
				{
					reject(new Error(errMsg));
				});
			});
		}

		function showToast(ui, message, isError)
		{
			try
			{
				var toast = document.getElementById('drawio-ai-toast');
				if (!toast)
				{
					toast = document.createElement('div');
					toast.id = 'drawio-ai-toast';
					toast.style.position = 'fixed';
					toast.style.bottom = '28px';
					toast.style.left = '50%';
					toast.style.transform = 'translateX(-50%)';
					toast.style.padding = '9px 18px';
					toast.style.borderRadius = '6px';
					toast.style.fontSize = '13px';
					toast.style.fontWeight = '500';
					toast.style.boxShadow = '0 4px 14px rgba(0,0,0,0.25)';
					toast.style.zIndex = '999999';
					toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
					toast.style.pointerEvents = 'none';
					toast.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
					document.body.appendChild(toast);
				}
				toast.style.backgroundColor = isError ? '#d93025' : '#202124';
				toast.style.color = '#ffffff';
				toast.textContent = message;
				toast.style.opacity = '1';
				toast.style.transform = 'translateX(-50%) translateY(0)';

				if (toast._timer) clearTimeout(toast._timer);
				toast._timer = setTimeout(function()
				{
					toast.style.opacity = '0';
					toast.style.transform = 'translateX(-50%) translateY(8px)';
				}, 3500);
			}
			catch (e)
			{
				if (ui && ui.status) ui.status(message, isError ? 'error' : 'info');
			}
		}

		function getCellLabel(cell, graph)
		{
			if (!cell) return '';
			var raw = '';
			if (graph && typeof graph.getLabel === 'function')
			{
				try { raw = graph.getLabel(cell); } catch (e) {}
			}
			if (!raw && cell.value)
			{
				if (typeof cell.value === 'string') raw = cell.value;
				else if (cell.value.getAttribute && cell.value.getAttribute('label')) raw = cell.value.getAttribute('label');
				else if (cell.value.textContent) raw = cell.value.textContent;
			}
			if (raw && typeof raw === 'string')
			{
				var tmp = document.createElement('div');
				tmp.innerHTML = raw;
				return (tmp.textContent || tmp.innerText || '').trim().replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
			}
			return (raw || '').toString().trim();
		}

		function getAllGraphVertices(graph)
		{
			var model = graph.getModel();
			var parent = graph.getDefaultParent();
			var vertices = [];
			var seen = {};

			for (var id in model.cells)
			{
				var cell = model.cells[id];
				if (cell && model.isVertex(cell) && cell !== parent && cell !== model.getRoot() && !seen[cell.id])
				{
					seen[cell.id] = true;
					var geo = model.getGeometry(cell);
					if (geo && (geo.width > 0 || geo.height > 0))
					{
						vertices.push(cell);
					}
				}
			}
			return vertices;
		}

		function resolveCell(key, nodeMap, verticesList, nodesDataList)
		{
			if (key == null) return null;
			var kStr = String(key).trim();
			if (nodeMap.byId[kStr]) return nodeMap.byId[kStr];

			// Match by number (1-based index)
			var num = parseInt(kStr.replace(/[^0-9]/g, ''), 10);
			if (!isNaN(num) && num >= 1 && num <= verticesList.length)
			{
				return verticesList[num - 1];
			}

			// Match by label
			var kLower = kStr.toLowerCase();
			if (nodeMap.byText[kLower]) return nodeMap.byText[kLower];

			for (var i = 0; i < nodesDataList.length; i++)
			{
				var t = nodesDataList[i].text.toLowerCase();
				if (t && (t.indexOf(kLower) !== -1 || kLower.indexOf(t) !== -1))
				{
					return verticesList[i];
				}
			}
			return null;
		}

		function runAutoConnect(ui)
		{
			var graph = ui.editor.graph;
			var model = graph.getModel();
			var selectedCells = graph.getSelectionCells();
			var vertices = [];

			if (selectedCells && selectedCells.length > 1)
			{
				for (var i = 0; i < selectedCells.length; i++)
				{
					if (model.isVertex(selectedCells[i])) vertices.push(selectedCells[i]);
				}
			}

			if (vertices.length === 0)
			{
				vertices = getAllGraphVertices(graph);
			}

			if (vertices.length < 2)
			{
				showToast(ui, '自動結線を行うには、キャンバス上に2つ以上のノードが必要です。', true);
				return;
			}

			// Sort vertices top-to-bottom, left-to-right
			vertices.sort(function(a, b)
			{
				var ga = model.getGeometry(a);
				var gb = model.getGeometry(b);
				var ya = ga ? ga.y : 0;
				var yb = gb ? gb.y : 0;
				if (Math.abs(ya - yb) > 25) return ya - yb;
				var xa = ga ? ga.x : 0;
				var xb = gb ? gb.x : 0;
				return xa - xb;
			});

			var nodeMap = { byId: {}, byText: {} };
			var nodesData = [];

			for (var j = 0; j < vertices.length; j++)
			{
				var v = vertices[j];
				var geo = model.getGeometry(v);
				var label = getCellLabel(v, graph) || ('ノード' + (j + 1));
				var styleStr = v.style || '';
				var shapeType = '処理ステップ';
				if (styleStr.indexOf('rhombus') !== -1 || styleStr.indexOf('shape=rhombus') !== -1)
				{
					shapeType = '条件分岐 (ひし形)';
				}
				else if (styleStr.indexOf('ellipse') !== -1)
				{
					shapeType = '開始/終了';
				}

				var nItem = {
					index: (j + 1),
					id: String(v.id),
					text: label,
					shape: shapeType,
					x: geo ? Math.round(geo.x) : 0,
					y: geo ? Math.round(geo.y) : 0,
					width: geo ? Math.round(geo.width) : 120,
					height: geo ? Math.round(geo.height) : 60
				};
				nodesData.push(nItem);

				nodeMap.byId[String(v.id)] = v;
				nodeMap.byId[j + 1] = v;
				nodeMap.byId['node_' + (j + 1)] = v;
				nodeMap.byId['node' + (j + 1)] = v;
				if (label)
				{
					nodeMap.byText[label.toLowerCase()] = v;
				}
			}

			if (ui.spinner) ui.spinner.spin(document.body, 'AIが全ノード（' + nodesData.length + '個）の関係性を解析して結線中...');

			var systemPrompt = 'あなたは業務フロー図・システムアーキテクチャ図の自動結線（Auto-Connect）を行う高度な専門AIです。\n' +
				'与えられたダイアグラム上のすべてのノード（合計 ' + nodesData.length + ' 個）について、ノードのテキスト内容・位置関係（上から下への順序、左右の並び）・形状（四角の処理ステップ、ひし形の条件分岐）を深く分析し、フローとして成立する完全な矢印接続リストを作成してください。\n\n' +
				'【結線の重要ルール】:\n' +
				'1. 【網羅性】: 一部のノードだけでなく、与えられた ' + nodesData.length + ' 個のすべてのノードを漏れなく接続してください。孤立ノード（矢印が1本も入出しないノード）を作らないでください。\n' +
				'2. 【条件分岐（ひし形）の接続】:\n' +
				'   - 「初診 or 再診」のようなひし形ノードからは、その下または左右に並ぶ選択肢ノード（例: 「問診・保険確認・初診...」「前回処置確認...」）へそれぞれ分岐矢印を接続し、label に「初診」「再診」などを指定してください。\n' +
				'   - 「診療区分」からは、「保険診療」「自費診療」「予防・メンテナンス」などの各選択肢ノードへそれぞれ分岐矢印を接続してください。\n' +
				'   - 「次回予約の有無」からは、「継続管理・リコール対象へ」「再案内・失注・中断フォロー」へそれぞれ分岐矢印（label: 「あり」「なし」等）を接続してください。\n' +
				'3. 【合流の接続】:\n' +
				'   - 分岐した選択肢ノード群（例: 保険診療 / 自費診療 / 予防）の完了後は、後続の共通ノード（例: 「会計・次回予約」など）へすべて合流接続してください。\n' +
				'4. 【順次フロー】:\n' +
				'   - 上流から下流へ論理的に流れるメインフロー（流入 -> 予約判定 -> 予約登録 -> 診療 -> 会計 -> データ統合 -> KPI集計 -> AI/BI分析 -> 経営判断 -> 改善ループ）をすべて上から下へ接続してください。\n' +
				'5. 【左右の関連ノード】:\n' +
				'   - 左右に配置された関連ノード（例: 歯科材料・機器、歯科技工所、人材採用、会計労務など）は、中央の関連する集約ノード（データ統合やKPI集計など）へ接続してください。\n' +
				'6. 【出力形式】:\n' +
				'   Markdownコードブロックや解説文は含めず、必ず以下のJSON配列のみを出力してください。\n' +
				'[\n' +
				'  { "source": "接続元ノードのindexまたはid", "target": "接続先ノードのindexまたはid", "label": "分岐条件ラベル（不要なら空文字）" }\n' +
				']';

			var userPrompt = '以下の ' + nodesData.length + ' 個のノード群を論理的なフローとして完全に接続する結線リストを作成してください:\n' + JSON.stringify(nodesData, null, 2);

			callAiBackend({
				systemPrompt: systemPrompt,
				userPrompt: userPrompt
			}).then(function(responseText)
			{
				if (ui.spinner) ui.spinner.stop();

				var cleanJson = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
				var connections = [];
				try
				{
					connections = JSON.parse(cleanJson);
				}
				catch (e)
				{
					var m = cleanJson.match(/\[[\s\S]*\]/);
					if (m) connections = JSON.parse(m[0]);
					else throw new Error('AIの応答をJSONとして解析できませんでした: ' + responseText);
				}

				if (!Array.isArray(connections) || connections.length === 0)
				{
					showToast(ui, '適切な接続関係を検出できませんでした。', true);
					return;
				}

				model.beginUpdate();
				var addedEdges = [];
				try
				{
					var parent = graph.getDefaultParent();
					var edgeStyle = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;';

					for (var k = 0; k < connections.length; k++)
					{
						var conn = connections[k];
						if (!conn) continue;
						var sourceCell = resolveCell(conn.source, nodeMap, vertices, nodesData);
						var targetCell = resolveCell(conn.target, nodeMap, vertices, nodesData);

						if (sourceCell && targetCell && sourceCell !== targetCell)
						{
							var existingEdges = graph.getEdgesBetween(sourceCell, targetCell, true);
							if (!existingEdges || existingEdges.length === 0)
							{
								var edge = graph.insertEdge(parent, null, conn.label || '', sourceCell, targetCell, edgeStyle);
								addedEdges.push(edge);
							}
						}
					}
				}
				finally
				{
					model.endUpdate();
				}

				if (addedEdges.length > 0)
				{
					graph.setSelectionCells(addedEdges);
					showToast(ui, addedEdges.length + ' 本の接続線を自動生成しました。');
				}
				else
				{
					showToast(ui, '接続対象の線は既に存在しています。');
				}
			}).catch(function(err)
			{
				if (ui.spinner) ui.spinner.stop();
				showToast(ui, '自動結線エラー: ' + err.message, true);
			});
		}

		function runAutoComplete(ui)
		{
			var graph = ui.editor.graph;
			var model = graph.getModel();
			var selected = graph.getSelectionCell();
			var targetVertex = null;

			if (selected && model.isVertex(selected)) targetVertex = selected;
			else
			{
				var all = getAllGraphVertices(graph);
				if (all && all.length > 0) targetVertex = all[all.length - 1];
			}

			if (!targetVertex)
			{
				showToast(ui, '追加の基準となるノードを選択してください。', true);
				return;
			}

			var currentLabel = getCellLabel(targetVertex, graph) || '現在のステップ';
			var allVertices = getAllGraphVertices(graph);
			var contextLabels = allVertices.map(function(v) { return getCellLabel(v, graph); }).filter(Boolean);

			if (ui.spinner) ui.spinner.spin(document.body, 'AIが次のステップを考えて追加中...');

			var systemPrompt = 'あなたは業務フロー・システム設計の専門アシスタントです。現在のノードに続く、次に発生すべき論理的なステップ（後続処理、条件分岐、完了処理など）を1〜3個提案してください。\n' +
				'必ず以下のJSON形式のみを出力してください:\n' +
				'[\n' +
				'  { "title": "ステップ名（簡潔に）", "condition": "矢印のラベル（例: 成功, OK, エラー時 等、不要なら空文字）", "type": "process | decision | end" }\n' +
				']';

			var userPrompt = '【全体の流れ】: ' + contextLabels.join(' -> ') + '\n【現在のステップ】: ' + currentLabel + '\nこの後に続くべき次ステップを提案してください。';

			callAiBackend({
				systemPrompt: systemPrompt,
				userPrompt: userPrompt
			}).then(function(responseText)
			{
				if (ui.spinner) ui.spinner.stop();

				var cleanJson = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
				var nextSteps = [];
				try { nextSteps = JSON.parse(cleanJson); }
				catch (e)
				{
					var m = cleanJson.match(/\[[\s\S]*\]/);
					if (m) nextSteps = JSON.parse(m[0]);
					else throw new Error('AIの応答をJSONとして解析できませんでした: ' + responseText);
				}

				if (!Array.isArray(nextSteps) || nextSteps.length === 0)
				{
					showToast(ui, '次ステップの提案が得られませんでした。', true);
					return;
				}

				var curGeo = model.getGeometry(targetVertex);
				var curX = curGeo ? curGeo.x : 100;
				var curY = curGeo ? curGeo.y : 100;

				model.beginUpdate();
				var newCells = [];
				try
				{
					var parent = graph.getDefaultParent();
					var nodeWidth = 140;
					var nodeHeight = 60;
					var gapX = 180;
					var gapY = 90;

					for (var i = 0; i < nextSteps.length; i++)
					{
						var step = nextSteps[i];
						var targetX = curX + gapX;
						var targetY = curY + (i - (nextSteps.length - 1) / 2) * gapY;

						var style = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;';
						if (step.type === 'decision')
						{
							style = 'rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;';
							nodeWidth = 120;
							nodeHeight = 80;
						}
						else if (step.type === 'end')
						{
							style = 'ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;';
						}

						var newVertex = graph.insertVertex(parent, null, step.title, targetX, targetY, nodeWidth, nodeHeight, style);
						var edgeStyle = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;';
						var newEdge = graph.insertEdge(parent, null, step.condition || '', targetVertex, newVertex, edgeStyle);

						newCells.push(newVertex);
						newCells.push(newEdge);
					}
				}
				finally
				{
					model.endUpdate();
				}

				graph.setSelectionCells(newCells);
				graph.scrollCellToVisible(newCells[0]);
				showToast(ui, '次のステップ（' + nextSteps.length + '件）を追加しました。');
			}).catch(function(err)
			{
				if (ui.spinner) ui.spinner.stop();
				showToast(ui, '追加エラー: ' + err.message, true);
			});
		}

		function runAutoLayout(ui)
		{
			var graph = ui.editor.graph;
			var model = graph.getModel();
			var parent = graph.getDefaultParent();
			model.beginUpdate();
			try
			{
				var layout = new mxHierarchicalLayout(graph, mxConstants.DIRECTION_NORTH);
				layout.intraCellSpacing = 50;
				layout.interRankCellSpacing = 60;
				layout.parallelEdgeSpacing = 20;
				layout.execute(parent);
			}
			finally
			{
				model.endUpdate();
			}
			showToast(ui, 'ダイアグラムを整列しました。');
		}

		function showAiSettingsDialog(ui)
		{
			ui = ui || window.drawioAiUi || (window.App && window.App.mainEditorUi);
			if (!ui)
			{
				console.error('EditorUi instance not found for showAiSettingsDialog');
				return;
			}

			getAiConfig().then(function(backendCfg)
			{
				var confStr = localStorage.getItem('.configuration');
				var conf = {};
				if (confStr)
				{
					try { conf = JSON.parse(confStr); } catch (e) {}
				}

				var container = document.createElement('div');
				container.style.padding = '18px 22px';
				container.style.boxSizing = 'border-box';
				container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
				container.style.color = 'inherit';

				var title = document.createElement('h3');
				title.innerHTML = 'draw.io AI 設定';
				title.style.margin = '0 0 8px 0';
				title.style.fontSize = '16px';
				title.style.color = 'light-dark(#1a73e8, #8ab4f8)';
				container.appendChild(title);

				var featureBox = document.createElement('div');
				featureBox.style.padding = '10px 12px';
				featureBox.style.marginBottom = '14px';
				featureBox.style.borderRadius = '8px';
				featureBox.style.backgroundColor = 'light-dark(#f0f4f9, #28292c)';
				featureBox.style.border = '1px solid light-dark(#d3e3fd, #3c4043)';
				featureBox.style.fontSize = '12px';
				featureBox.style.lineHeight = '1.5';

				featureBox.innerHTML = '<div style="font-weight:bold;color:light-dark(#1a73e8,#8ab4f8);margin-bottom:4px;">機能の概要</div>' +
					'<div style="display:grid;grid-template-columns:1fr;gap:4px;">' +
					'<div><b>ノード間の自動結線:</b> 散らばったボックス同士の関係性を分析し、適切な矢印線で自動接続します。</div>' +
					'<div><b>次のステップ追加:</b> 選択したボックスの後に続く処理・分岐をAIが考えて自動追加します。</div>' +
					'<div><b>チャットで図の生成・修正:</b> 左パネルから日本語で指示するだけで、図の作成や修正ができます。</div>' +
					'</div>';
				container.appendChild(featureBox);

				var stepLabel = document.createElement('div');
				stepLabel.innerHTML = '<b>API キーの設定</b>';
				stepLabel.style.fontSize = '13px';
				stepLabel.style.marginBottom = '10px';
				container.appendChild(stepLabel);

				function createFormField(label, badge, helpHtml, inputEl)
				{
					var row = document.createElement('div');
					row.style.marginBottom = '12px';
					row.style.padding = '8px 10px';
					row.style.borderRadius = '6px';
					row.style.backgroundColor = 'light-dark(#fafafa, #1e1f22)';
					row.style.border = '1px solid light-dark(#e8eaed, #323539)';

					var topRow = document.createElement('div');
					topRow.style.display = 'flex';
					topRow.style.alignItems = 'center';
					topRow.style.justifyContent = 'space-between';
					topRow.style.marginBottom = '4px';

					var lbl = document.createElement('label');
					lbl.innerHTML = label;
					lbl.style.fontSize = '12px';
					lbl.style.fontWeight = 'bold';
					topRow.appendChild(lbl);

					if (badge)
					{
						var bdg = document.createElement('span');
						bdg.innerHTML = badge;
						bdg.style.fontSize = '10px';
						bdg.style.padding = '1px 6px';
						bdg.style.borderRadius = '10px';
						bdg.style.backgroundColor = 'light-dark(#e6f4ea, #1e3a29)';
						bdg.style.color = 'light-dark(#137333, #81c995)';
						bdg.style.fontWeight = 'bold';
						topRow.appendChild(bdg);
					}

					row.appendChild(topRow);
					row.appendChild(inputEl);

					if (helpHtml)
					{
						var h = document.createElement('div');
						h.innerHTML = helpHtml;
						h.style.fontSize = '11px';
						h.style.marginTop = '4px';
						row.appendChild(h);
					}

					return row;
				}

				function createInput(type, val, placeholder)
				{
					var inp = document.createElement('input');
					inp.type = type;
					inp.value = val || '';
					inp.placeholder = placeholder || '';
					inp.style.width = '100%';
					inp.style.padding = '6px 8px';
					inp.style.borderRadius = '4px';
					inp.style.border = '1px solid #dadce0';
					inp.style.fontSize = '12px';
					inp.style.boxSizing = 'border-box';
					return inp;
				}

				var geminiVal = conf.geminiApiKey || Editor.aiGlobals['geminiApiKey'] || (backendCfg.provider === 'gemini' ? backendCfg.apiKey : '');
				var geminiInput = createInput('password', geminiVal, 'AIzaSy... (Gemini API Key を入力)');
				var geminiRow = createFormField('Google Gemini', '推奨・無料枠あり',
					'<span style="color:#5f6368;">手軽に始めるなら一番おすすめです。</span> <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:#1a73e8;text-decoration:underline;font-weight:bold;">Google AI Studio で無料取得する ↗</a>',
					geminiInput);
				container.appendChild(geminiRow);

				var gptVal = conf.gptApiKey || Editor.aiGlobals['gptApiKey'] || (backendCfg.provider === 'openai' ? backendCfg.apiKey : '');
				var gptInput = createInput('password', gptVal, 'sk-... (OpenAI API Key を入力)');
				var gptRow = createFormField('OpenAI (ChatGPT / GPT-4o)', '',
					'<a href="https://platform.openai.com/api-keys" target="_blank" style="color:#1a73e8;text-decoration:none;">OpenAI Platform でキーを発行 ↗</a>',
					gptInput);
				container.appendChild(gptRow);

				var claudeVal = conf.claudeApiKey || Editor.aiGlobals['claudeApiKey'] || (backendCfg.provider === 'claude' ? backendCfg.apiKey : '');
				var claudeInput = createInput('password', claudeVal, 'sk-ant-... (Claude API Key を入力)');
				var claudeRow = createFormField('Anthropic Claude (Claude 3.7 Sonnet)', '',
					'<a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:#1a73e8;text-decoration:none;">Anthropic Console でキーを発行 ↗</a>',
					claudeInput);
				container.appendChild(claudeRow);

				var statusDiv = document.createElement('div');
				statusDiv.style.fontSize = '12px';
				statusDiv.style.margin = '8px 0';
				statusDiv.style.minHeight = '18px';
				container.appendChild(statusDiv);

				var btnRow = document.createElement('div');
				btnRow.style.display = 'flex';
				btnRow.style.justifyContent = 'space-between';
				btnRow.style.alignItems = 'center';
				btnRow.style.marginTop = '14px';

				var testBtn = mxUtils.button('接続テスト', function()
				{
					var gKey = geminiInput.value.trim();
					var oKey = gptInput.value.trim();
					var cKey = claudeInput.value.trim();

					var testProvider = gKey ? 'gemini' : (oKey ? 'openai' : (cKey ? 'claude' : 'gemini'));
					var testKey = gKey || oKey || cKey;

					if (!testKey)
					{
						statusDiv.innerText = 'API キーを入力してください。';
						statusDiv.style.color = '#ea8600';
						return;
					}

					statusDiv.innerText = '接続テスト中 (' + testProvider.toUpperCase() + ')...';
					statusDiv.style.color = '#1a73e8';

					callAiBackend({
						provider: testProvider,
						apiKey: testKey,
						systemPrompt: 'You are a test assistant.',
						userPrompt: 'Hello'
					}).then(function()
					{
						statusDiv.innerText = '接続成功: AIサービスと正常に対話できました。';
						statusDiv.style.color = '#137333';
					}).catch(function(err)
					{
						statusDiv.innerText = '接続失敗: ' + err.message;
						statusDiv.style.color = '#c5221f';
					});
				});
				testBtn.className = 'geBtn';

				var rightBtns = document.createElement('div');
				rightBtns.style.display = 'flex';
				rightBtns.style.gap = '8px';

				var cancelBtn = mxUtils.button(mxResources.get('cancel') || 'キャンセル', function()
				{
					ui.hideDialog();
				});
				cancelBtn.className = 'geBtn';

				var saveBtn = mxUtils.button('設定を保存', function()
				{
					var gVal = geminiInput.value.trim();
					var oVal = gptInput.value.trim();
					var cVal = claudeInput.value.trim();

					var activeProvider = gVal ? 'gemini' : (oVal ? 'openai' : (cVal ? 'claude' : 'gemini'));
					var activeKey = gVal || oVal || cVal;

					var newBackendCfg = {
						provider: activeProvider,
						apiKey: activeKey,
						geminiApiKey: gVal,
						gptApiKey: oVal,
						claudeApiKey: cVal
					};

					saveAiConfig(newBackendCfg).then(function()
					{
						syncConfiguration({
							geminiApiKey: gVal,
							gptApiKey: oVal,
							claudeApiKey: cVal
						});

						if (ui.chatWindow && ui.chatWindow.window && ui.chatWindow.window.isVisible())
						{
							try
							{
								ui.chatWindow.destroy();
								ui.chatWindow = null;
								if (typeof ui.showChatWindow === 'function') ui.showChatWindow();
								else if (ui.actions.get('chat')) ui.actions.get('chat').funct();
							}
							catch (e) {}
						}

						ui.hideDialog();
						showToast(ui, 'AI設定を保存しました。');
					}).catch(function(err)
					{
						ui.alert('保存エラー: ' + err.message);
					});
				});
				saveBtn.className = 'geBtn gePrimaryBtn';

				btnRow.appendChild(testBtn);
				rightBtns.appendChild(cancelBtn);
				rightBtns.appendChild(saveBtn);
				btnRow.appendChild(rightBtns);
				container.appendChild(btnRow);

				ui.showDialog(container, 540, 520, true, true);
			}).catch(function(err)
			{
				console.error('Failed to open AI settings dialog:', err);
				ui.alert('AI設定の表示に失敗しました: ' + err.message);
			});
		}

		return {
			callAiBackend: callAiBackend,
			getAiConfig: getAiConfig,
			saveAiConfig: saveAiConfig,
			runAutoConnect: runAutoConnect,
			runAutoComplete: runAutoComplete,
			runAutoLayout: runAutoLayout,
			showAiSettingsDialog: showAiSettingsDialog
		};
	})();

	// ==========================================
	// Right-Side Embedded Multi-Tab AI Browser Panel
	// ==========================================
	window.drawioAiBrowser = (function()
	{
		var panel = null;
		var tabListContainer = null;
		var webviewContainer = null;
		var urlInput = null;
		var autoStickyBtn = null;
		var isOpen = false;
		var tabs = []; // [{ id, title, url, webview, titleSpan }]
		var activeTabId = null;
		var tabCounter = 1;
		var isAutoStickyEnabled = localStorage.getItem('.aiAutoStickyNote') === 'true';
		var lastClipboardText = '';
		var stickyNoteCounter = 0;
		var currentWidth = parseInt(localStorage.getItem('.aiBrowserWidth') || '520', 10);
		if (isNaN(currentWidth) || currentWidth < 360) currentWidth = 520;

		function insertStickyNote(text)
		{
			if (!text || typeof text !== 'string') return null;
			var cleanText = text.trim();
			if (!cleanText) return null;

			var ui = window.drawioAiUi;
			if (!ui || !ui.editor || !ui.editor.graph)
			{
				console.warn('draw.io editor not ready for sticky note insertion');
				return null;
			}

			var graph = ui.editor.graph;
			var model = graph.getModel();
			var parent = graph.getDefaultParent();

			// Calculate optimal size based on text content
			var lines = cleanText.split('\n');
			var maxLineLen = 0;
			for (var i = 0; i < lines.length; i++)
			{
				if (lines[i].length > maxLineLen) maxLineLen = lines[i].length;
			}

			var w = Math.min(360, Math.max(180, Math.min(280, maxLineLen * 9 + 40)));
			var h = Math.min(480, Math.max(100, Math.max(lines.length * 22 + 40, Math.ceil(cleanText.length / 18) * 20 + 40)));

			// Position sticky note in visible canvas center with cascading offset
			var view = graph.view;
			var scale = view.scale || 1;
			var translate = view.translate || { x: 0, y: 0 };
			var container = graph.container;

			var visibleCenterX = (-translate.x + (container.clientWidth / 2) / scale);
			var visibleCenterY = (-translate.y + (container.clientHeight / 2) / scale);

			// Cascading offset so multiple notes stack nicely without full overlap
			var offset = (stickyNoteCounter % 7) * 24;
			stickyNoteCounter++;

			var posX = Math.max(20, Math.round(visibleCenterX - (w / 2) + offset));
			var posY = Math.max(20, Math.round(visibleCenterY - (h / 2) + offset));

			// Classic pleasant sticky note palette colors
			var colors = [
				{ fill: '#FFF9B2', stroke: '#d6b656' }, // Yellow
				{ fill: '#D5E8D4', stroke: '#82B366' }, // Mint Green
				{ fill: '#DAE8FC', stroke: '#6C8EBF' }, // Soft Blue
				{ fill: '#F8CECC', stroke: '#B85450' }, // Pastel Pink
				{ fill: '#FFE6CC', stroke: '#D79B00' }  // Warm Orange
			];
			var color = colors[(stickyNoteCounter - 1) % colors.length];

			// Style: shape=note with folded corner, shadow, proper line wrapping & padding
			var noteStyle = 'shape=note;whiteSpace=wrap;html=1;size=16;' +
				'fillColor=' + color.fill + ';strokeColor=' + color.stroke + ';' +
				'fontColor=#222222;fontSize=13;align=left;verticalAlign=top;spacing=10;spacingTop=6;shadow=1;';

			model.beginUpdate();
			var vertex = null;
			try
			{
				vertex = graph.insertVertex(parent, null, cleanText, posX, posY, w, h, noteStyle);
				graph.setSelectionCell(vertex);
				graph.scrollCellToVisible(vertex);
			}
			catch (err)
			{
				console.error('Failed to insert sticky note:', err);
			}
			finally
			{
				model.endUpdate();
			}

			// Show quick toast feedback
			try
			{
				if (typeof showToast === 'function')
				{
					showToast(ui, '📌 付箋をキャンバスに貼り付けました');
				}
			}
			catch (e) {}

			return vertex;
		}

		// Initialize clipboard watcher to auto-paste sticky notes on copy
		try
		{
			if (typeof electron !== 'undefined' && electron.clipboard)
			{
				lastClipboardText = electron.clipboard.readText() || '';
			}
		}
		catch (e) {}

		setInterval(function()
		{
			if (!isOpen || !isAutoStickyEnabled) return;
			try
			{
				if (typeof electron !== 'undefined' && electron.clipboard)
				{
					var currentText = electron.clipboard.readText();
					if (currentText && currentText.trim() && currentText !== lastClipboardText)
					{
						lastClipboardText = currentText;
						// Ignore diagram XML or excessive large files
						if (currentText.length < 50000 && !currentText.startsWith('<mxfile') && !currentText.startsWith('<mxGraphModel'))
						{
							insertStickyNote(currentText);
						}
					}
				}
			}
			catch (e) {}
		}, 400);

		function updateLayoutShift()
		{
			var geEditors = document.querySelectorAll('.geEditor');
			for (var i = 0; i < geEditors.length; i++)
			{
				if (isOpen)
				{
					geEditors[i].style.right = currentWidth + 'px';
					geEditors[i].style.width = 'calc(100% - ' + currentWidth + 'px)';
				}
				else
				{
					geEditors[i].style.right = '0px';
					geEditors[i].style.width = '100%';
				}
			}

			if (window.drawioAiUi)
			{
				try
				{
					if (isOpen && window.drawioAiUi.formatWidth === 0)
					{
						window.drawioAiUi.formatWidth = 240;
					}
					window.drawioAiUi.refresh();
					if (window.drawioAiUi.editor && window.drawioAiUi.editor.graph)
					{
						window.drawioAiUi.editor.graph.sizeDidChange();
					}
				}
				catch (e) {}
			}

			try
			{
				window.dispatchEvent(new Event('resize'));
			}
			catch (e) {}
		}

		function getTab(tabId)
		{
			for (var i = 0; i < tabs.length; i++)
			{
				if (tabs[i].id === tabId) return tabs[i];
			}
			return null;
		}

		function getActiveTab()
		{
			return getTab(activeTabId);
		}

		function syncUrlBar()
		{
			var active = getActiveTab();
			if (active && urlInput)
			{
				urlInput.value = active.webview.src || active.url || '';
			}
		}

		function renderTabs()
		{
			if (!tabListContainer) return;
			tabListContainer.innerHTML = '';

			tabs.forEach(function(tab)
			{
				var isActive = tab.id === activeTabId;
				var tabEl = document.createElement('div');
				tabEl.style.display = 'inline-flex';
				tabEl.style.alignItems = 'center';
				tabEl.style.gap = '6px';
				tabEl.style.padding = '4px 10px';
				tabEl.style.fontSize = '12px';
				tabEl.style.fontWeight = isActive ? '600' : '400';
				tabEl.style.borderRadius = '6px 6px 0 0';
				tabEl.style.backgroundColor = isActive ? 'light-dark(#ffffff, #1e1f22)' : 'light-dark(#e8eaed, #2d2f31)';
				tabEl.style.color = isActive ? 'light-dark(#1a73e8, #8ab4f8)' : 'inherit';
				tabEl.style.border = isActive ? '1px solid light-dark(#dadce0, #3c4043)' : '1px solid transparent';
				tabEl.style.borderBottom = isActive ? '1px solid light-dark(#ffffff, #1e1f22)' : 'none';
				tabEl.style.cursor = 'pointer';
				tabEl.style.maxWidth = '160px';
				tabEl.style.userSelect = 'none';
				tabEl.style.marginBottom = '-1px';

				var titleSpan = document.createElement('span');
				titleSpan.textContent = tab.title || '新しいタブ';
				titleSpan.style.whiteSpace = 'nowrap';
				titleSpan.style.overflow = 'hidden';
				titleSpan.style.textOverflow = 'ellipsis';
				tabEl.appendChild(titleSpan);
				tab.titleSpan = titleSpan;

				// Close tab button
				var closeBtn = document.createElement('span');
				closeBtn.innerHTML = '&times;';
				closeBtn.style.fontSize = '14px';
				closeBtn.style.padding = '0 2px';
				closeBtn.style.borderRadius = '3px';
				closeBtn.style.cursor = 'pointer';
				closeBtn.style.opacity = '0.6';
				closeBtn.addEventListener('mouseenter', function() { closeBtn.style.opacity = '1'; });
				closeBtn.addEventListener('mouseleave', function() { closeBtn.style.opacity = '0.6'; });
				closeBtn.addEventListener('click', function(e)
				{
					e.stopPropagation();
					closeTab(tab.id);
				});
				tabEl.appendChild(closeBtn);

				tabEl.addEventListener('click', function()
				{
					switchTab(tab.id);
				});

				tabListContainer.appendChild(tabEl);
			});

			// Add "+" button
			var addBtn = document.createElement('button');
			addBtn.textContent = '+';
			addBtn.setAttribute('title', '新規タブを開く');
			addBtn.style.padding = '2px 8px';
			addBtn.style.fontSize = '14px';
			addBtn.style.fontWeight = 'bold';
			addBtn.style.borderRadius = '4px';
			addBtn.style.border = 'none';
			addBtn.style.background = 'none';
			addBtn.style.cursor = 'pointer';
			addBtn.style.color = 'inherit';
			addBtn.style.opacity = '0.7';
			addBtn.addEventListener('mouseenter', function() { addBtn.style.opacity = '1'; });
			addBtn.addEventListener('mouseleave', function() { addBtn.style.opacity = '0.7'; });
			addBtn.addEventListener('click', function()
			{
				addTab('https://www.google.com', '新しいタブ');
			});
			tabListContainer.appendChild(addBtn);
		}

		function addTab(url, title)
		{
			createPanel();
			var tabId = 'tab_' + (tabCounter++);
			var tabTitle = title || (url.includes('chatgpt') ? 'ChatGPT' : (url.includes('claude') ? 'Claude' : (url.includes('gemini') ? 'Gemini' : '新しいタブ')));

			var wv = document.createElement('webview');
			wv.setAttribute('partition', 'persist:drawio_ai_browser');
			wv.setAttribute('allowpopups', 'true');
			wv.src = url;
			wv.style.flex = '1';
			wv.style.width = '100%';
			wv.style.height = '100%';
			wv.style.border = 'none';
			wv.style.display = 'none';

			var tabObj = {
				id: tabId,
				title: tabTitle,
				url: url,
				webview: wv
			};

			wv.addEventListener('did-navigate', function(e)
			{
				tabObj.url = e.url;
				if (activeTabId === tabId) syncUrlBar();
			});

			wv.addEventListener('did-navigate-in-page', function(e)
			{
				tabObj.url = e.url;
				if (activeTabId === tabId) syncUrlBar();
			});

			wv.addEventListener('page-title-updated', function(e)
			{
				if (e.title)
				{
					var clean = e.title.split(' - ')[0].split(' | ')[0].trim();
					if (clean)
					{
						tabObj.title = clean;
						if (tabObj.titleSpan) tabObj.titleSpan.textContent = clean;
					}
				}
			});

			webviewContainer.appendChild(wv);
			tabs.push(tabObj);
			switchTab(tabId);
			return tabObj;
		}

		function switchTab(tabId)
		{
			activeTabId = tabId;
			tabs.forEach(function(t)
			{
				if (t.id === tabId)
				{
					t.webview.style.display = 'flex';
				}
				else
				{
					t.webview.style.display = 'none';
				}
			});
			renderTabs();
			syncUrlBar();
		}

		function closeTab(tabId)
		{
			var idx = -1;
			for (var i = 0; i < tabs.length; i++)
			{
				if (tabs[i].id === tabId) { idx = i; break; }
			}
			if (idx === -1) return;

			var target = tabs[idx];
			if (target.webview && target.webview.parentNode)
			{
				target.webview.parentNode.removeChild(target.webview);
			}
			tabs.splice(idx, 1);

			if (tabs.length === 0)
			{
				addTab('https://chatgpt.com', 'ChatGPT');
			}
			else
			{
				if (activeTabId === tabId)
				{
					var nextIdx = Math.min(idx, tabs.length - 1);
					switchTab(tabs[nextIdx].id);
				}
				else
				{
					renderTabs();
				}
			}
		}

		function openPreset(url, name)
		{
			createPanel();
			// Check if tab with matching URL/name already exists
			for (var i = 0; i < tabs.length; i++)
			{
				if (tabs[i].url.includes(url.replace('https://', '')) || tabs[i].title.toLowerCase().includes(name.toLowerCase()))
				{
					switchTab(tabs[i].id);
					open();
					return;
				}
			}
			addTab(url, name);
			open();
		}

		function createPanel()
		{
			if (panel) return panel;

			panel = document.createElement('div');
			panel.id = 'drawio-ai-browser-panel';
			panel.style.position = 'fixed';
			panel.style.top = '0';
			panel.style.right = '0';
			panel.style.bottom = '0';
			panel.style.width = currentWidth + 'px';
			panel.style.zIndex = '4999';
			panel.style.display = 'none';
			panel.style.flexDirection = 'column';
			panel.style.backgroundColor = 'light-dark(#ffffff, #1e1f22)';
			panel.style.borderLeft = '1px solid light-dark(#dadce0, #3c4043)';
			panel.style.boxShadow = '-4px 0 20px rgba(0, 0, 0, 0.2)';
			panel.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

			// Resizable Drag Handle (Splitter)
			var splitter = document.createElement('div');
			splitter.style.position = 'absolute';
			splitter.style.left = '-4px';
			splitter.style.top = '0';
			splitter.style.bottom = '0';
			splitter.style.width = '8px';
			splitter.style.cursor = 'col-resize';
			splitter.style.zIndex = '50';
			panel.appendChild(splitter);

			var isDragging = false;
			splitter.addEventListener('mousedown', function(e)
			{
				isDragging = true;
				document.body.style.userSelect = 'none';
				tabs.forEach(function(t) { if (t.webview) t.webview.style.pointerEvents = 'none'; });
				e.preventDefault();
			});

			window.addEventListener('mousemove', function(e)
			{
				if (!isDragging) return;
				var newWidth = window.innerWidth - e.clientX;
				if (newWidth >= 340 && newWidth <= (window.innerWidth - 250))
				{
					currentWidth = newWidth;
					panel.style.width = currentWidth + 'px';
					localStorage.setItem('.aiBrowserWidth', currentWidth);
					updateLayoutShift();
				}
			});

			window.addEventListener('mouseup', function()
			{
				if (isDragging)
				{
					isDragging = false;
					document.body.style.userSelect = '';
					tabs.forEach(function(t) { if (t.webview) t.webview.style.pointerEvents = 'auto'; });
				}
			});

			// Header Toolbar
			var header = document.createElement('div');
			header.style.display = 'flex';
			header.style.flexDirection = 'column';
			header.style.backgroundColor = 'light-dark(#f1f3f4, #28292a)';
			header.style.borderBottom = '1px solid light-dark(#dadce0, #3c4043)';

			// Row 1: Tabs List & Panel Close Button
			var tabRow = document.createElement('div');
			tabRow.style.display = 'flex';
			tabRow.style.alignItems = 'center';
			tabRow.style.justifyContent = 'space-between';
			tabRow.style.padding = '6px 8px 0 8px';

			tabListContainer = document.createElement('div');
			tabListContainer.style.display = 'flex';
			tabListContainer.style.alignItems = 'center';
			tabListContainer.style.gap = '3px';
			tabListContainer.style.overflowX = 'auto';
			tabListContainer.style.flex = '1';
			tabRow.appendChild(tabListContainer);

			var closePanelBtn = document.createElement('button');
			closePanelBtn.innerHTML = '&times;';
			closePanelBtn.setAttribute('title', 'ブラウザパネルを閉じる');
			closePanelBtn.style.background = 'none';
			closePanelBtn.style.border = 'none';
			closePanelBtn.style.fontSize = '20px';
			closePanelBtn.style.fontWeight = 'bold';
			closePanelBtn.style.cursor = 'pointer';
			closePanelBtn.style.padding = '0 6px';
			closePanelBtn.style.color = 'inherit';
			closePanelBtn.addEventListener('click', function()
			{
				close();
			});
			tabRow.appendChild(closePanelBtn);
			header.appendChild(tabRow);

			// Row 2: Preset Quick Buttons & Auto-Sticky Toggle
			var presetRow = document.createElement('div');
			presetRow.style.display = 'flex';
			presetRow.style.alignItems = 'center';
			presetRow.style.justifyContent = 'space-between';
			presetRow.style.padding = '6px 10px';
			presetRow.style.backgroundColor = 'light-dark(#ffffff, #1e1f22)';
			presetRow.style.borderTop = '1px solid light-dark(#dadce0, #3c4043)';
			presetRow.style.borderBottom = '1px solid light-dark(#dadce0, #3c4043)';

			var presetGroup = document.createElement('div');
			presetGroup.style.display = 'flex';
			presetGroup.style.alignItems = 'center';
			presetGroup.style.gap = '4px';

			function createPresetBtn(label, url)
			{
				var btn = document.createElement('button');
				btn.textContent = label;
				btn.style.padding = '3px 8px';
				btn.style.fontSize = '11px';
				btn.style.fontWeight = '600';
				btn.style.borderRadius = '4px';
				btn.style.border = '1px solid light-dark(#dadce0, #5f6368)';
				btn.style.backgroundColor = 'light-dark(#f8f9fa, #292a2d)';
				btn.style.color = 'inherit';
				btn.style.cursor = 'pointer';
				btn.addEventListener('click', function()
				{
					openPreset(url, label);
				});
				return btn;
			}

			presetGroup.appendChild(createPresetBtn('ChatGPT', 'https://chatgpt.com'));
			presetGroup.appendChild(createPresetBtn('Claude', 'https://claude.ai'));
			presetGroup.appendChild(createPresetBtn('Gemini', 'https://gemini.google.com'));
			presetGroup.appendChild(createPresetBtn('Perplexity', 'https://www.perplexity.ai'));
			presetRow.appendChild(presetGroup);

			// Auto Sticky Note Toggle Button
			autoStickyBtn = document.createElement('button');
			function updateAutoStickyBtnUI()
			{
				if (isAutoStickyEnabled)
				{
					autoStickyBtn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:4px;">📌 自動付箋: <b style="color:#137333;">ON</b></span>';
					autoStickyBtn.setAttribute('title', '自動付箋モード: 有効中\nブラウザ上でコピーしたテキストが自動的にキャンバスへ付箋として貼り付けられます。（クリックでOFF）');
					autoStickyBtn.style.backgroundColor = 'light-dark(#e6f4ea, #1e3a29)';
					autoStickyBtn.style.color = 'light-dark(#137333, #81c995)';
					autoStickyBtn.style.borderColor = 'light-dark(#34a853, #81c995)';
				}
				else
				{
					autoStickyBtn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:4px;">📌 自動付箋: <span style="opacity:0.7;">OFF</span></span>';
					autoStickyBtn.setAttribute('title', '自動付箋モード: 無効\nクリックしてONにすると、ブラウザ上でコピーしたテキストが自動的に付箋として貼り付けられます。');
					autoStickyBtn.style.backgroundColor = 'light-dark(#f8f9fa, #292a2d)';
					autoStickyBtn.style.color = 'inherit';
					autoStickyBtn.style.borderColor = 'light-dark(#dadce0, #5f6368)';
				}
			}

			autoStickyBtn.style.padding = '3px 8px';
			autoStickyBtn.style.fontSize = '11px';
			autoStickyBtn.style.fontWeight = '600';
			autoStickyBtn.style.borderRadius = '4px';
			autoStickyBtn.style.border = '1px solid light-dark(#dadce0, #5f6368)';
			autoStickyBtn.style.cursor = 'pointer';
			autoStickyBtn.style.marginLeft = 'auto';
			updateAutoStickyBtnUI();

			autoStickyBtn.addEventListener('click', function()
			{
				isAutoStickyEnabled = !isAutoStickyEnabled;
				localStorage.setItem('.aiAutoStickyNote', isAutoStickyEnabled ? 'true' : 'false');
				try
				{
					if (typeof electron !== 'undefined' && electron.clipboard)
					{
						lastClipboardText = electron.clipboard.readText() || '';
					}
				}
				catch (e) {}
				updateAutoStickyBtnUI();
				if (window.drawioAiUi && typeof showToast === 'function')
				{
					showToast(window.drawioAiUi, isAutoStickyEnabled ? '📌 自動付箋モードを ON にしました（コピーした内容が自動で付箋になります）' : '📌 自動付箋モードを OFF にしました');
				}
			});
			presetRow.appendChild(autoStickyBtn);
			header.appendChild(presetRow);

			// Row 3: Navigation buttons, URL bar & Quick Add Note
			var navRow = document.createElement('div');
			navRow.style.display = 'flex';
			navRow.style.alignItems = 'center';
			navRow.style.gap = '4px';
			navRow.style.padding = '6px 10px';
			navRow.style.backgroundColor = 'light-dark(#ffffff, #1e1f22)';

			function createNavBtn(icon, title, onClick)
			{
				var btn = document.createElement('button');
				btn.textContent = icon;
				btn.setAttribute('title', title);
				btn.style.padding = '3px 7px';
				btn.style.fontSize = '12px';
				btn.style.borderRadius = '4px';
				btn.style.border = '1px solid light-dark(#dadce0, #5f6368)';
				btn.style.backgroundColor = 'light-dark(#ffffff, #2d2f31)';
				btn.style.color = 'inherit';
				btn.style.cursor = 'pointer';
				btn.addEventListener('click', onClick);
				return btn;
			}

			navRow.appendChild(createNavBtn('◀', '戻る', function()
			{
				var active = getActiveTab();
				if (active && active.webview && active.webview.canGoBack && active.webview.canGoBack()) active.webview.goBack();
			}));
			navRow.appendChild(createNavBtn('▶', '進む', function()
			{
				var active = getActiveTab();
				if (active && active.webview && active.webview.canGoForward && active.webview.canGoForward()) active.webview.goForward();
			}));
			navRow.appendChild(createNavBtn('⟳', '再読み込み', function()
			{
				var active = getActiveTab();
				if (active && active.webview) active.webview.reload();
			}));

			urlInput = document.createElement('input');
			urlInput.type = 'text';
			urlInput.placeholder = 'https://... または検索キーワード';
			urlInput.style.flex = '1';
			urlInput.style.padding = '4px 8px';
			urlInput.style.fontSize = '12px';
			urlInput.style.borderRadius = '4px';
			urlInput.style.border = '1px solid light-dark(#dadce0, #5f6368)';
			urlInput.style.backgroundColor = 'light-dark(#f8f9fa, #292a2d)';
			urlInput.style.color = 'inherit';
			urlInput.style.boxSizing = 'border-box';

			urlInput.addEventListener('keydown', function(e)
			{
				if (e.key === 'Enter')
				{
					var target = urlInput.value.trim();
					if (target)
					{
						if (!/^https?:\/\//i.test(target))
						{
							if (target.indexOf('.') !== -1 && target.indexOf(' ') === -1)
							{
								target = 'https://' + target;
							}
							else
							{
								target = 'https://www.google.com/search?q=' + encodeURIComponent(target);
							}
						}
						var active = getActiveTab();
						if (active)
						{
							active.webview.src = target;
						}
						else
						{
							addTab(target, target);
						}
					}
				}
			});
			navRow.appendChild(urlInput);

			// Manual Quick "＋ 付箋化" Button
			var addNoteBtn = createNavBtn('＋ 付箋化', '選択中のテキストまたはクリップボード内容を付箋としてキャンバスに追加', function()
			{
				var active = getActiveTab();
				if (active && active.webview)
				{
					active.webview.executeJavaScript('window.getSelection().toString()').then(function(selText)
					{
						if (selText && selText.trim())
						{
							insertStickyNote(selText);
						}
						else
						{
							var clipText = typeof electron !== 'undefined' && electron.clipboard ? electron.clipboard.readText() : '';
							if (clipText && clipText.trim() && !clipText.startsWith('<mxfile'))
							{
								insertStickyNote(clipText);
							}
							else if (window.drawioAiUi)
							{
								window.drawioAiUi.alert('ブラウザ上でテキストを選択するか、コピーしてから押してください。');
							}
						}
					}).catch(function()
					{
						var clipText = typeof electron !== 'undefined' && electron.clipboard ? electron.clipboard.readText() : '';
						if (clipText && clipText.trim() && !clipText.startsWith('<mxfile'))
						{
							insertStickyNote(clipText);
						}
					});
				}
			});
			addNoteBtn.style.fontWeight = '600';
			addNoteBtn.style.color = 'light-dark(#1a73e8, #8ab4f8)';
			addNoteBtn.style.whiteSpace = 'nowrap';
			navRow.appendChild(addNoteBtn);

			header.appendChild(navRow);

			panel.appendChild(header);

			// Webview Container
			webviewContainer = document.createElement('div');
			webviewContainer.style.flex = '1';
			webviewContainer.style.display = 'flex';
			webviewContainer.style.position = 'relative';
			webviewContainer.style.overflow = 'hidden';
			panel.appendChild(webviewContainer);

			document.body.appendChild(panel);

			// Default Initial Tabs
			addTab('https://chatgpt.com', 'ChatGPT');
			addTab('https://claude.ai', 'Claude');
			switchTab(tabs[0].id);

			return panel;
		}

		function open(url)
		{
			createPanel();
			isOpen = true;
			panel.style.display = 'flex';
			updateLayoutShift();
			if (url)
			{
				addTab(url, url);
			}
			else
			{
				syncUrlBar();
			}
		}

		function close()
		{
			if (panel)
			{
				isOpen = false;
				panel.style.display = 'none';
				updateLayoutShift();
			}
		}

		function toggle(url)
		{
			if (isOpen && panel && panel.style.display !== 'none')
			{
				close();
			}
			else
			{
				open(url);
			}
		}

		return {
			open: open,
			close: close,
			toggle: toggle,
			addTab: addTab,
			switchTab: switchTab,
			closeTab: closeTab,
			openPreset: openPreset,
			insertStickyNote: insertStickyNote
		};
	})();

	Menus.prototype.defaultMenuItems = ['file', 'edit', 'view', 'arrange', 'aiMenu', 'extras', 'help'];
	mxResources.parse('aiMenu=AI');

	var origToolbarInit = Toolbar.prototype.init;
	Toolbar.prototype.init = function()
	{
		origToolbarInit.apply(this, arguments);

		try
		{
			this.addSeparator();
			var aiBtn = document.createElement('a');
			aiBtn.className = 'geButton';
			aiBtn.setAttribute('title', 'AI アシスタント (自動結線・追加・設定)');
			aiBtn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:3px;font-weight:600;color:light-dark(#1a73e8,#8ab4f8);font-size:12px;padding:3px 8px;border-radius:4px;border:1px solid light-dark(#dadce0,#5f6368);">AI ▾</span>';
			aiBtn.style.cursor = 'pointer';
			var tb = this;

			mxEvent.addListener(aiBtn, 'click', function(evt)
			{
				var rect = aiBtn.getBoundingClientRect();
				tb.editorUi.showPopupMenu(function(m, p)
				{
					m.addItem('線の自動接続 (Auto-Connect)', null, function()
					{
						window.drawioAi.runAutoConnect(tb.editorUi);
					}, p);

					m.addItem('次のステップを追加 (Auto-Complete)', null, function()
					{
						window.drawioAi.runAutoComplete(tb.editorUi);
					}, p);

					m.addItem('自動レイアウト整形 (Auto-Layout)', null, function()
					{
						window.drawioAi.runAutoLayout(tb.editorUi);
					}, p);

					m.addSeparator(p);

					m.addItem('右側ブラウザパネルを開く (ChatGPT / Claude)', null, function()
					{
						window.drawioAiBrowser.toggle();
					}, p);

					m.addItem('AI 生成・チャットパネルを開く', null, function()
					{
						if (tb.editorUi.actions.get('chat'))
						{
							tb.editorUi.actions.get('chat').funct();
						}
					}, p);

					m.addSeparator(p);

					m.addItem('AI 設定 (API キー・モデル)...', null, function()
					{
						window.drawioAi.showAiSettingsDialog(tb.editorUi);
					}, p);
				}, rect.left, rect.bottom + 4, evt);
				mxEvent.consume(evt);
			});

			this.container.appendChild(aiBtn);

			// Browser Button
			var browserBtn = document.createElement('a');
			browserBtn.className = 'geButton';
			browserBtn.setAttribute('title', 'AI ブラウザ (ChatGPT / Claude / Gemini を右側に表示)');
			browserBtn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:3px;font-weight:600;color:light-dark(#1a73e8,#8ab4f8);font-size:12px;padding:3px 8px;border-radius:4px;border:1px solid light-dark(#dadce0,#5f6368);">ブラウザ ◨</span>';
			browserBtn.style.cursor = 'pointer';
			mxEvent.addListener(browserBtn, 'click', function(evt)
			{
				window.drawioAiBrowser.toggle();
				mxEvent.consume(evt);
			});
			this.container.appendChild(browserBtn);
		}
		catch (e)
		{
			console.error('Failed to add AI toolbar button:', e);
		}
	};

	var origCreatePopupMenu = Menus.prototype.createPopupMenu;
	Menus.prototype.createPopupMenu = function(menu, cell, evt)
	{
		origCreatePopupMenu.apply(this, arguments);

		var ui = this.editorUi;
		menu.addSeparator();
		if (cell != null)
		{
			menu.addItem('AI: 次のステップを追加', null, function() { window.drawioAi.runAutoComplete(ui); });
			menu.addItem('AI: 自動結線 (ノード間に線を引く)', null, function() { window.drawioAi.runAutoConnect(ui); });
		}
		else
		{
			menu.addItem('AI: 全要素を自動結線', null, function() { window.drawioAi.runAutoConnect(ui); });
			menu.addItem('AI: 自動レイアウト整形', null, function() { window.drawioAi.runAutoLayout(ui); });
			menu.addItem('右側ブラウザパネルを開く', null, function() { window.drawioAiBrowser.toggle(); });
			menu.addItem('AI 設定', null, function() { window.drawioAi.showAiSettingsDialog(ui); });
		}
	};

	var menusInit = Menus.prototype.init;
	Menus.prototype.init = function()
	{
		menusInit.apply(this, arguments);

		var editorUi = this.editorUi;

		this.put('aiMenu', new Menu(mxUtils.bind(this, function(menu, parent)
		{
			menu.addItem('線の自動接続 (Auto-Connect)', null, function()
			{
				window.drawioAi.runAutoConnect(editorUi);
			}, parent);

			menu.addItem('次のステップを追加 (Auto-Complete)', null, function()
			{
				window.drawioAi.runAutoComplete(editorUi);
			}, parent);

			menu.addItem('自動レイアウト整形 (Auto-Layout)', null, function()
			{
				window.drawioAi.runAutoLayout(editorUi);
			}, parent);

			menu.addSeparator(parent);

			menu.addItem('右側ブラウザパネルを開く (ChatGPT / Claude)', null, function()
			{
				window.drawioAiBrowser.toggle();
			}, parent);

			menu.addItem('AI 生成・チャットパネルを開く', null, function()
			{
				if (editorUi.actions.get('chat'))
				{
					editorUi.actions.get('chat').funct();
				}
			}, parent);

			menu.addSeparator(parent);

			menu.addItem('AI 設定 (API キー・モデル)...', null, function()
			{
				window.drawioAi.showAiSettingsDialog(editorUi);
			}, parent);
		})));
		
		this.put('openRecent', new Menu(function(menu, parent)
		{
			var recent = editorUi.getRecent();

			if (recent != null)
			{
				for (var i = 0; i < recent.length; i++)
				{
					(function(entry)
					{
						menu.addItem(entry.title, null, function()
						{
							function doOpenRecent()
							{
								//Simulate opening a file via args
								editorUi.loadArgs({args: [entry.id]});
							};
							
							var file = editorUi.getCurrentFile();
							
							if (file != null && file.isModified())
							{
								editorUi.confirm(mxResources.get('allChangesLost'), null, doOpenRecent,
									mxResources.get('cancel'), mxResources.get('discardChanges'));
							}
							else
							{
								doOpenRecent();
							}
						}, parent);
					})(recent[i]);
				}

				menu.addSeparator(parent);
			}

			menu.addItem(mxResources.get('reset'), null, function()
			{
				editorUi.resetRecent();
			}, parent);
		}));
		
		// Replaces file menu to replace openFrom menu with open and rename downloadAs to export
		this.put('file', new Menu(mxUtils.bind(this, function(menu, parent)
		{
			this.addMenuItems(menu, ['new', 'open'], parent);
			this.addSubmenu('openRecent', menu, parent);
			this.addMenuItems(menu, ['-', 'synchronize', '-', 'save', 'saveAs', '-', 'import'], parent);
			this.addSubmenu('exportAs', menu, parent);
			menu.addSeparator(parent);
			this.addSubmenu('embed', menu, parent);
			this.addMenuItems(menu, ['presentationMode'], parent);
			menu.addSeparator(parent);
			this.addMenuItems(menu, ['newLibrary', 'openLibrary'], parent);

			if (editorUi.getCurrentFile() != null && editorUi.fileNode != null)
			{
				this.addMenuItems(menu, ['-', 'properties']);
			}
			
			this.addMenuItems(menu, ['-', 'pageSetup', 'print', '-', 'close', '-', 'exit'], parent);
		})));
	};

	var graphCreateLinkForHint = Graph.prototype.createLinkForHint;
	
	Graph.prototype.createLinkForHint = function(href, label, associatedCell)
	{
		var a = graphCreateLinkForHint.call(this, href, label, associatedCell);
		
		if (href != null && !this.isCustomLink(href))
		{
			// KNOWN: Event with gesture handler mouseUp the middle click opens a framed window
			mxEvent.addListener(a, 'click', mxUtils.bind(this, function(evt)
			{
				// The href is not written for links that did not pass the check
				// in createLinkForHint, in which case there is nothing to open
				var url = a.getAttribute('href');

				if (url != null)
				{
					this.openLink(url, a.getAttribute('target'));
				}

				mxEvent.consume(evt);
			}));
		}
		
		return a;
	};
	
	Graph.prototype.openLink = async function(url, target)
	{
		await requestSync({action: 'openExternal', url: url});
	};

	// Initializes the user interface
	var editorUiInit = EditorUi.prototype.init;
	EditorUi.prototype.init = async function()
	{
		editorUiInit.apply(this, arguments);

		var editorUi = this;
		var graph = this.editor.graph;
		window.drawioAiUi = this;

		editorUi.actions.addAction('aiAutoConnect', function() { window.drawioAi.runAutoConnect(editorUi); });
		editorUi.actions.addAction('aiAutoComplete', function() { window.drawioAi.runAutoComplete(editorUi); });
		editorUi.actions.addAction('aiAutoLayout', function() { window.drawioAi.runAutoLayout(editorUi); });
		editorUi.actions.addAction('aiSettings', function() { window.drawioAi.showAiSettingsDialog(editorUi); });
		editorUi.actions.addAction('toggleAiBrowser', function() { window.drawioAiBrowser.toggle(); });
		
		electron.registerMsgListener('isModified', (uniqueId) =>
		{
			const currentFile = editorUi.getCurrentFile();
			let reply = {isModified: false, draftPath: null, uniqueId: uniqueId};

			if (currentFile != null)
			{
				if (editorUi.editor.graph.isEditing())
				{
					editorUi.editor.graph.stopEditing();
				}

				reply.isModified = currentFile.isModified();
				reply.draftPath = EditorUi.enableDrafts && currentFile.fileObject? currentFile.fileObject.draftFileName : null;
			}

			electron.sendMessage('isModified-result', reply);
		});

		electron.registerMsgListener('removeDraft', () =>
		{
			editorUi.getCurrentFile().removeDraft();
			electron.sendMessage('draftRemoved', {});
		});

		electron.registerMsgListener('saveAndClose', (uniqueId) =>
		{
			const currentFile = editorUi.getCurrentFile();
			let resultSent = false;

			// Ensures a single result is sent even if the save flow calls
			// more than one callback
			let sendResult = (success) =>
			{
				if (!resultSent)
				{
					resultSent = true;
					electron.sendMessage('saveAndClose-result', {uniqueId: uniqueId, success: success});
				}
			};

			if (currentFile == null || !currentFile.isModified())
			{
				sendResult(true);
			}
			else
			{
				editorUi.saveFile(null, () => sendResult(true),
					() => sendResult(false), () => sendResult(false));
			}
		});

		// Adds support for libraries
		this.actions.addAction('newLibrary...', mxUtils.bind(this, function()
		{
			editorUi.showLibraryDialog(null, null, null, null, App.MODE_DEVICE);
		}));
		
		this.actions.addAction('openLibrary...', mxUtils.bind(this, function()
		{
			editorUi.pickLibrary(App.MODE_DEVICE);
		}));

		// Replaces import action
		this.actions.addAction('import...', mxUtils.bind(this, async function()
		{
			if (editorUi.getCurrentFile() != null)
			{
				var lastDir = localStorage.getItem('.lastImpDir');
				
				var paths = await requestSync({
					action: 'showOpenDialog',
					defaultPath: lastDir || (await requestSync('getDocumentsFolder')),
					properties: ['openFile']
				});
			           
		        if (paths !== undefined && paths[0] != null)
		        {
		        	var path = paths[0];
		        	localStorage.setItem('.lastImpDir', await requestSync({action: 'dirname', path: path}));
		        	var asImage = /\.png$/i.test(path) || /\.gif$/i.test(path) || /\.jpe?g$/i.test(path);
		        	var encoding = (asImage || /\.pdf$/i.test(path) || /\.vsdx$/i.test(path) || /\.vssx$/i.test(path)) ?
		        		'base64' : 'utf-8';

					if (editorUi.spinner.spin(document.body, mxResources.get('loading')))
					{
						electron.request({action: 'readFile', filename: path, encoding: encoding} , mxUtils.bind(this, function (data)
				        {
							try
							{
								if (editorUi.isLucidChartData(data))
								{
									editorUi.convertLucidChart(data, function(xml)
									{
										editorUi.spinner.stop();
										graph.setSelectionCells(editorUi.importXml(xml));
									}, function(e)
									{
										editorUi.spinner.stop();
										editorUi.handleError(e);
									});
								}
								else if  (/(\.vsdx)($|\?)/i.test(path))
								{
									editorUi.importVisio(editorUi.base64ToBlob(data, 'application/octet-stream'), function(xml)
									{
										editorUi.spinner.stop();
										graph.setSelectionCells(editorUi.importXml(xml));
									});
								}
								else if (editorUi.isGliffyData(data, path))
								{
									editorUi.spinner.stop();
									editorUi.showError(mxResources.get('error'), mxResources.get('notInDesktop'));
								}
								else
								{
									if (/\.pdf$/i.test(path))
									{
										var tmp = Editor.extractGraphModelFromPdf(data);
										
										if (tmp != null)
										{
											data = tmp;
										}
									}
									else if (/\.png$/i.test(path))
									{
										var tmp = editorUi.extractGraphModelFromPng(data);
										
										if (tmp != null)
										{
											asImage = false;
											data = tmp;
										}
									}
									else if (/\.svg$/i.test(path))
									{
										// LATER: Use importXml without throwing exception if no data
										// Checks if SVG contains content attribute
										var root = mxUtils.parseXml(data);
										var svgs = root.getElementsByTagName('svg');
										
										if (svgs.length > 0)
										{
											var svgRoot = svgs[0];
											var cont = svgRoot.getAttribute('content');

											if (cont != null && cont.charAt(0) != '<' && cont.charAt(0) != '%')
											{
												cont = unescape((window.atob) ? atob(cont) : Base64.decode(cont, true));
											}
											
											if (cont != null && cont.charAt(0) == '%')
											{
												cont = decodeURIComponent(cont);
											}

											if (cont != null && (cont.substring(0, 8) === '<mxfile ' ||
												cont.substring(0, 14) === '<mxGraphModel '))
											{
												asImage = false;
												data = cont;
											}
											else
											{
												asImage = true;
											}
										}
									}
									
									if (asImage)
									{
										var img = new Image();
										img.onload = function()
										{
											editorUi.resizeImage(img, img.src, function(data2, w, h)
											{
												editorUi.spinner.stop();
												var pt = graph.getInsertPoint();
												graph.setSelectionCell(graph.insertVertex(null, null, '', pt.x, pt.y, w, h,
													'shape=image;aspect=fixed;image=' + editorUi.convertDataUri(data2) + ';'));
											}, true);
										};
										
										img.onerror = function(e)
										{
											editorUi.spinner.stop();
											editorUi.handleError();
										};
										
										var format = path.substring(path.lastIndexOf('.') + 1);
										img.src = (format == 'svg') ? Editor.createSvgDataUri(data) :
											'data:image/' + format + ';base64,' + data;
									}
									else
									{
										editorUi.spinner.stop();
										
										if (data != null)
										{
											graph.setSelectionCells(editorUi.importXml(data));

											var curFile = editorUi.getCurrentFile();
											if (curFile != null)
											{
												var filename = path.replace(/^.*[\\\/]/, '');
												var isUntitled = !curFile.fileObject || curFile.getTitle() === '名称未設定ファイル' || curFile.getTitle() === editorUi.defaultFilename || curFile.getTitle() === 'Untitled Diagram.drawio';
												if (isUntitled)
												{
													curFile.setTitle(filename);
													curFile.fileObject = {
														name: filename,
														path: path,
														type: encoding
													};
													editorUi.updateDocumentTitle();
													if (typeof curFile.addToRecent === 'function')
													{
														curFile.addToRecent();
													}
												}
											}
										}
									}
								}
							}
							catch(e)
							{
								editorUi.spinner.stop();
								editorUi.handleError(e);
							}
			        	}), function(e)
						{
							editorUi.spinner.stop();
							editorUi.handleError(e);
						});
					}
		        }
			}
		}));
		
		// Replaces new action
		var oldNew = this.actions.get('new').funct;
		
		this.actions.addAction('new...', mxUtils.bind(this, function()
		{
			if (this.getCurrentFile() == null)
			{
				oldNew();
			}
			else
			{
				electron.sendMessage('newfile', {width: 1600});
			}
		}), null, null, Editor.ctrlKey + '+N');
		
		this.actions.get('open').shortcut = Editor.ctrlKey + '+O';
		
		// Adds shortcut keys for file operations
		editorUi.keyHandler.bindAction(78, true, 'new'); // Ctrl+N
		editorUi.keyHandler.bindAction(79, true, 'open'); // Ctrl+O

		var isFullScreen = await requestSync('isFullscreen');

		var fullscreenAction = editorUi.actions.addAction('fullscreen', async function()
		{
			electron.sendMessage('toggleFullscreen');
			isFullScreen = await requestSync('isFullscreen');
		});

		fullscreenAction.visible = true;
		fullscreenAction.setToggleAction(true);
		
		fullscreenAction.setSelectedCallback(function()
		{
			return isFullScreen;
		});
		
		function createGraph()
		{
			var graph = new Graph();
	        graph.setExtendParents(false);
	        graph.setExtendParentsOnAdd(false);
	        graph.setConstrainChildren(false);
	        graph.setHtmlLabels(true);
	        graph.getModel().maintainEdgeParent = false;
	        return graph;
		};
		
		async function cloneMxCLipboardToSys()
		{
			var cells = mxClipboard.getCells();
			
			if (cells && cells.length > 0)
			{
				try
				{
					var tmpGraph = createGraph();
					tmpGraph.importCells(cells, 0, 0, tmpGraph.getDefaultParent());
					var codec = new mxCodec();
		            var node = codec.encode(tmpGraph.getModel());
		            var modelString = mxUtils.getXml(node);
					await requestSync({
						action: 'clipboardAction', 
						method: 'writeText',
						data: encodeURIComponent(modelString)
					});
				}
				catch(e)
				{
					//Ignore
				} 
			}
		};
		
		async function cloneSysCLipboardToMx()
		{
			try
			{
				var modelString = await requestSync({
					action: 'clipboardAction', 
					method: 'readText',
				});
				
				if (modelString)
				{
					modelString = decodeURIComponent(modelString);
					var xmlDoc = mxUtils.parseXml(modelString);
					var tmpGraph = createGraph();
					var codec = new mxCodec(xmlDoc);
					var model = tmpGraph.getModel();
					codec.decode(xmlDoc.documentElement, model);
					mxClipboard.setCells(model.root.children[0].children);
				}
			}
			catch(e)
			{
				//Ignore, the contents of mxClipboard will be used
			}
		};
		
		//Set system clipboard on menu copy/cut
		var origCut = this.actions.get('cut').funct;
		
		editorUi.actions.addAction('cut', function()
		{
			origCut();
			cloneMxCLipboardToSys();
		}, null, '', Editor.ctrlKey + '+X');
		
		var origCopy = this.actions.get('copy').funct;
		
		editorUi.actions.addAction('copy', function()
		{
			origCopy();
			cloneMxCLipboardToSys();
		}, null, '', Editor.ctrlKey + '+C');
		
		//Get data from system clipboard for pase/pasteHere
		var origPaste = this.actions.get('paste').funct;
		
		editorUi.actions.addAction('paste', function()
		{
			cloneSysCLipboardToMx();
			origPaste();
		}, false, '', Editor.ctrlKey + '+V');
	
		var origPasteHere = this.actions.get('pasteHere').funct;

		editorUi.actions.addAction('pasteHere', function()
		{
			cloneSysCLipboardToMx();
			origPasteHere();
		});
		
		//Enable paste action even if mxClipboard is empty! TODO Is this OK?
		editorUi.updatePasteActionStates = function()
		{
			var graph = this.editor.graph;
			var paste = this.actions.get('paste');
			var pasteHere = this.actions.get('pasteHere');
			
			paste.setEnabled(this.editor.graph.cellEditor.isContentEditing() || 
				(graph.isEnabled() && !graph.isCellLocked(graph.getDefaultParent())));
			pasteHere.setEnabled(paste.isEnabled());
		};
		
		editorUi.actions.addAction('plugins...', function()
		{
			var pluginsMap = {};
			//Initialize it with plugins in settings
			var plugins = (mxSettings.settings != null) ? mxSettings.getPlugins() : null;

			if (plugins != null)
			{
				for (var i = 0; i < plugins.length; i++)
				{
					pluginsMap[plugins[i]] = true;
				}
			}

			editorUi.showDialog(new PluginsDialog(editorUi, function(callback)
			{
				var div = document.createElement('div');
				
				var title = document.createElement('span');
				title.style.marginTop = '6px';
				mxUtils.write(title, mxResources.get('builtinPlugins') + ': ');
				div.appendChild(title);
				
				var pluginsSelect = document.createElement('select');
				pluginsSelect.style.width = '150px';
				
				for (var i = 0; i < App.publicPlugin.length; i++)
				{
					var p = App.publicPlugin[i];

					if  (pluginsMap[App.pluginRegistry[p]]) continue;

					var option = document.createElement('option');
					mxUtils.write(option, p);
					option.value = p;
					pluginsSelect.appendChild(option);
				}
				
				div.appendChild(pluginsSelect);
							
				var dlg = new CustomDialog(editorUi, div, mxUtils.bind(this, function()
				{
					var newP = App.pluginRegistry[pluginsSelect.value];
					pluginsMap[newP] = true;
	        		callback(newP);
				}));
				editorUi.showDialog(dlg.container, 300, 125, true, true);
			},
			function(plugin)
			{
				delete pluginsMap[plugin];
			}, true).container, 380, null, true, false);
		});

		editorUi.actions.addAction('exit', function()
		{
			electron.request({
				action: 'exit'
			});
		});
	}
	
	var appLoad = App.prototype.load;

	App.prototype.load = function()
	{
		appLoad.apply(this, arguments);
		
		electron.registerMsgListener('args-obj', (argsObj) =>
		{
			this.loadArgs(argsObj)
		})

		//We do some async stuff during app loading so we need to know exactly when loading is finished (it is not when onload is finished)
		electron.sendMessage('app-load-finished', null);

		//Change offline translation
		mxResources.parse('notInOffline=' + mxResources.get('notInDesktop'));
	}
	
	App.prototype.loadArgs = function(argsObj)
	{
		var paths = argsObj.args;
		var layoutName = argsObj.layout;
		// Set by the --mermaid-image command-line flag (parsed in the desktop
		// main process, like layout): opens .mmd/.mermaid files as a static
		// image instead of an editable diagram.
		var mermaidImage = argsObj.mermaidImage;

		// If a file is passed, and it is not an argument (has a leading -)
		if (paths !== undefined && paths[0] != null && paths[0].indexOf('-') != 0 && this.spinner.spin(document.body, mxResources.get('loading')))
		{
			var path = paths[0];
			this.hideDialog();

			var success = mxUtils.bind(this, function(fileEntry, data, stat, name, isModified)
			{
				this.spinner.stop();

				if (data != null)
				{
					var file = new LocalFile(this, data, name || '');
					file.fileObject = fileEntry;
					file.stat = stat;
					file.setModified(isModified? true : false);
					this.fileLoaded(file);

					// --layout: run the requested ELK layout once the diagram
					// is loaded (applies to any opened file, generated or not).
					// executeLayoutSpec (EditorUi) is shared with the embed
					// "layout" action and the #create / load "layout" option.
					if (layoutName != null)
					{
						this.executeLayoutSpec(layoutName);
					}
				}
			});
			
			var error = mxUtils.bind(this, function(e)
			{
				this.spinner.stop();
				
				if (e.code === 'ENOENT')
				{
					var title = path.replace(/^.*[\\\/]/, '');
					var data = this.emptyDiagramXml;
					var file = new LocalFile(this, data, title, null);
					
					file.fileObject = new Object();
					file.fileObject.path = path;
					file.fileObject.name = title;
					file.fileObject.type = 'utf-8';
					this.fileCreated(file, null, null, null);					
					this.saveFile();
				}
				else
				{
					this.handleError(e);
				}
				
			});
			
			// Tries to open the file
			this.readGraphFile(success, error, path, null, mermaidImage);
		}
		// If no file is passed, but there is the "create-if-not-exists" flag
		else if (argsObj.create != null)
		{
			var title = 'Untitled document';
			var data = this.emptyDiagramXml;
			var file = new LocalFile(this, data, title, null);
			this.fileCreated(file, null, null, null);
		}
		else
		{
			this.checkDrafts();
		}
	}

	// whenScriptReady (bundle-load poll) and the --layout resolver are shared
	// with the webapp; see EditorUi.prototype.whenScriptReady /
	// EditorUi.prototype.executeLayoutSpec in diagramly/EditorUi.js.

	var origFileLoaded = EditorUi.prototype.fileLoaded;
	
	EditorUi.prototype.fileLoaded = async function(file)
	{
		var oldFile = this.getCurrentFile();

		if (oldFile != null)
		{
			//TODO This assumes the user confirmed discarding the file changes to get to this function?
			if (EditorUi.enableDrafts)
			{
				oldFile.removeDraft();
			}
		}
		
		if (file != null)
		{
			if (file.fileObject == null)
			{
				var fname = file.getTitle();
				
				var fileInfo = openFilesMap[fname] || openFilesMap[fname + '.drawio'] || (fname && fname.lastIndexOf('.') > -1 ? openFilesMap[fname.substring(0, fname.lastIndexOf('.'))] : null);
				
				if (!fileInfo)
				{
					for (var k in openFilesMap)
					{
						if (openFilesMap[k])
						{
							fileInfo = openFilesMap[k];
							break;
						}
					}
				}

				if (fileInfo != null)
				{
					file.fileObject = {
						name: fileInfo.name,
						path: fileInfo.path,
						type: fileInfo.type || 'utf-8'
					};
					//delete it such that it is not used again incorrectly
					delete openFilesMap[fileInfo.name];
				}
			}
			
			if (file.fileObject != null)
			{
				file.addToRecent();
			}
		}

		this.watchFile(file);
		origFileLoaded.apply(this, arguments);
	};

	var origSetCurrentFile = EditorUi.prototype.setCurrentFile;

	EditorUi.prototype.setCurrentFile = function(file)
	{
		origSetCurrentFile.apply(this, arguments);
		this.watchFile(file);
	};

	// Monitor the given file for changes
	EditorUi.prototype.watchFile = async function(file)
	{
		var newPath = (file != null && file.fileObject != null &&
			file == this.getCurrentFile()) ? file.fileObject.path : null;
		
		if (this.watchedPath != newPath)
		{
			this.unwatchPath(this.watchedPath);
		}

		if (newPath != null)
		{
			this.watchedPath = newPath;
			this.watchPath(newPath);
		}
	};
	
	// Unwatches the given path
	EditorUi.prototype.unwatchPath = async function(path)
	{
		if (path != null)
		{
			EditorUi.debug('EditorUi.unwatchPath', [this], 'path', [path]);

			await requestSync({action: 'unwatchFile', path: path});
		};
	};

	// Watches the path for changes
	EditorUi.prototype.watchPath = async function(path)
	{
		if (path != null)
		{
			EditorUi.debug('EditorUi.watchPath', [this], 'path', [path]);

			await requestSync({
				action: 'watchFile', 
				path: path,
				listener: mxUtils.bind(this, function(curr, prev) 
				{
					var file = this.getCurrentFile();

					if (file != null && file.fileObject != null &&
						file.fileObject.path == path)
					{
						this.handleFileChange(curr, prev, file);
					}
				})
			});
		}
	};

	// Uses local picker
	EditorUi.prototype.handleFileChange = function(curr, prev, file)
	{
		// File not deleted, changed (not just accessed) and not already in conflict state
		if (curr.mtimeMs != 0 && curr.mtimeMs != prev.mtimeMs && !file.inConflictState)
		{
			//Ignore our own changes
			if (file.unwatchedSaves || (file.stat != null && file.stat.mtimeMs == curr.mtimeMs))
			{
				file.unwatchedSaves = false;
				return;
			}

			EditorUi.debug('EditorUi.handleFileChange', [this],
				'file', [file], 'stat', [file.stat],
				'curr', [curr], 'prev', [prev],
				'unwatchedSaves', file.unwatchedSaves);

			var addConflictStatus = mxUtils.bind(this, function(latestFile)
			{
				file.inConflictState = true;

				file.addConflictStatus(null, mxUtils.bind(this, function()
				{
					file.ui.updateStatus(mxUtils.bind(this, function()
					{
						file.ui.editor.setStatus(mxUtils.htmlEntities(
							mxResources.get('updatingDocument')));
					}));

					file.synchronizeFile(mxUtils.bind(this, function()
					{
						file.handleFileSuccess(false);
					}), mxUtils.bind(this, function(err)
					{
						file.handleFileError(err, true);
					}));
				}));
			});

			// Checks checksums before notifiying in case of timestamp change
			if (curr.size == prev.size)
			{
				file.getLatestVersion(mxUtils.bind(this, function(latestFile)
				{
					if (this.getHashValueForPages(file.getShadowPages()) !==
						this.getHashValueForPages(latestFile.getShadowPages()))
					{
						addConflictStatus(latestFile);
					}
					else
					{
						// Adopts the new stat for timestamp-only changes (eg. FUSE
						// mounts finalize mtime after write) so the next save
						// doesn't misdetect a conflict
						file.stat = latestFile.stat;

						EditorUi.debug('EditorUi.handleFileChange', [this],
							'No changes detected in file', [file]);
					}
				}), addConflictStatus);
			}
			else
			{
				addConflictStatus();
			}
		}
	};

	// Uses local picker
	App.prototype.pickFile = function()
	{
		var doPickFile = mxUtils.bind(this, function()
		{
			this.chooseFileEntry(mxUtils.bind(this, function(fileEntry, data, stat, name, isModified)
			{
				var file = new LocalFile(this, data, '');
				file.fileObject = fileEntry;
				file.stat = stat;
				file.setModified(isModified? true : false);
				this.fileLoaded(file);
			}));
		});

		var file = this.getCurrentFile();
		
		if (file != null && file.isModified())
		{
			this.confirm(mxResources.get('allChangesLost'), null, doPickFile,
				mxResources.get('cancel'), mxResources.get('discardChanges'));
		}
		else
		{
			doPickFile();
		}
	};
	
	/**
	 * Selects a library to load from a picker
	 * 
	 * @param mode the device mode, ignored in this case
	 */
	App.prototype.pickLibrary = function(mode)
	{
		this.chooseFileEntry(mxUtils.bind(this, function(fileEntry, data, stat)
		{
			try
			{
				var library = new DesktopLibrary(this, data, fileEntry);
				this.loadLibrary(library);
				this.showSidebar();
			}
			catch (e)
			{
				this.handleError(e, mxResources.get('errorLoadingFile'));
			}
		}));
	};
	
	// Uses local picker
	App.prototype.chooseFileEntry = async function(fn)
	{
		var lastDir = localStorage.getItem('.lastOpenDir');
		
		var paths = await requestSync({
			action: 'showOpenDialog',
			defaultPath: lastDir || (await requestSync('getDocumentsFolder')),
			filters: [
				{ name: 'draw.io Diagrams', extensions: ['drawio', 'xml', 'png', 'svg', 'html', 'pdf'] },
        	    { name: 'VSDX Documents', extensions: ['vsdx'] },
        	    { name: 'Mermaid', extensions: ['mmd', 'mermaid'] },
        	    { name: 'All Files', extensions: ['*'] }
			],
			properties: ['openFile']
		});
	           
        if (paths !== undefined && paths[0] != null)
        {
        	localStorage.setItem('.lastOpenDir', await requestSync({action: 'dirname', path: paths[0]}));

			this.readGraphFile(fn, mxUtils.bind(this, function(err)
			{
				this.handleError(err);
			}), paths[0]);
        }
        else
        {
        	this.spinner.stop();
        }
	};
	
	EditorUi.prototype.normalizeFilename = function(title, defaultExtension)
	{
		if (!title || typeof title !== 'string')
		{
			title = mxResources.get('untitledDiagram');
		}

		var tokens = title.split('.');
		var ext = (tokens.length > 1) ? tokens[tokens.length - 1] : '';
		defaultExtension = (defaultExtension != null) ? defaultExtension : 'drawio';

		if (tokens.length == 1 || mxUtils.indexOf(['xml',
			'html', 'drawio', 'png', 'svg', 'pdf'], ext) < 0)
		{
			tokens.push(defaultExtension);
		}

		return tokens.join('.');
	};

	// Adds .pdf to the stripped extensions so exports of foo.drawio.pdf
	// derive foo.* filenames like the other editable formats
	EditorUi.prototype.getBaseFilename = function(ignorePageName)
	{
		var file = this.getCurrentFile();
		var basename = (file != null && file.getTitle() != null) ? file.getTitle() : this.defaultFilename;

		if (/(\.xml)$/i.test(basename) || /(\.html)$/i.test(basename) ||
			/(\.svg)$/i.test(basename) || /(\.png)$/i.test(basename) ||
			/(\.pdf)$/i.test(basename))
		{
			basename = basename.substring(0, basename.lastIndexOf('.'));
		}

		if (/(\.drawio)$/i.test(basename))
		{
			basename = basename.substring(0, basename.lastIndexOf('.'));
		}

		if (!ignorePageName && this.pages != null && this.pages.length > 1 &&
			this.currentPage != null && this.currentPage.node.getAttribute('name') != null &&
			this.currentPage.getName().length > 0)
		{
			basename = basename + '-' + this.currentPage.getName();
		}

		return basename;
	};

	//In order not to repeat the logic for opening a file, we collect files information here and use them in openLocalFile
	var origOpenFiles = EditorUi.prototype.openFiles;
	var openFilesMap = {};
	
	EditorUi.prototype.openFiles = function(files, temp)
	{
		openFilesMap = {};

		for (var i = 0; i < files.length; i++)
		{
			openFilesMap[files[i].name] = files[i];
		}
		
		origOpenFiles.apply(this, arguments);
	};

	var origImportFiles = EditorUi.prototype.importFiles;
	EditorUi.prototype.importFiles = function(files, x, y, maxSize, fn, resultFn, filterFn, barrierFn, resizeImages, lazy)
	{
		if (files != null && files.length > 0)
		{
			for (var i = 0; i < files.length; i++)
			{
				if (files[i] && files[i].name)
				{
					openFilesMap[files[i].name] = files[i];

					if (files[i].path)
					{
						var curFile = this.getCurrentFile();
						if (curFile != null)
						{
							var isUntitled = !curFile.fileObject || curFile.getTitle() === '名称未設定ファイル' || curFile.getTitle() === this.defaultFilename || curFile.getTitle() === 'Untitled Diagram.drawio';
							if (isUntitled)
							{
								curFile.setTitle(files[i].name);
								curFile.fileObject = {
									name: files[i].name,
									path: files[i].path,
									type: 'utf-8'
								};
								this.updateDocumentTitle();
								if (typeof curFile.addToRecent === 'function')
								{
									curFile.addToRecent();
								}
							}
						}
					}
				}
			}
		}
		return origImportFiles.apply(this, arguments);
	};
	
	App.prototype.readGraphFile = function(fn, fnErr, path, noDraftCheck, mermaidImage)
	{
		var index = path.lastIndexOf('.png');
		var isPng = index > -1 && index == path.length - 4;
		var isVsdx = /\.vsdx$/i.test(path) || /\.vssx$/i.test(path);
		var isMermaid = /\.mmd$/i.test(path) || /\.mermaid$/i.test(path);
		var encoding = isVsdx? null : ((isPng || /\.pdf$/i.test(path)) ? 'base64' : 'utf-8');
		var fileEntry = new Object(), stat = null;
		fileEntry.path = path;
		fileEntry.name = path.replace(/^.*[\\\/]/, '');
		fileEntry.type = encoding;

		var checkDrafts = mxUtils.bind(this, function()
		{
			if (noDraftCheck) return;

			electron.request({
				action: 'getFileDrafts',
				fileObject: fileEntry
			}, mxUtils.bind(this, function(drafts)
			{
				if (drafts.length > 0)
				{
					var dlg = new DraftDialog(this, mxResources.get('unsavedChanges'),
								(drafts.length > 1) ? null : drafts[0].data, mxUtils.bind(this, async function(index)
					{
						index = index || 0;
						this.hideDialog();
						fn(fileEntry, drafts[index].data, stat, null, true);
						await requestSync({action: 'deleteFile', file: drafts[index].path});
					}), mxUtils.bind(this, async function(index)
					{
						index = index || 0;
						await requestSync({action: 'deleteFile', file: drafts[index].path});
						this.hideDialog();
					}), null, null, null, (drafts.length > 1) ? drafts : null);
					
					this.showDialog(dlg.container, 640, 480, true, false);
					
					dlg.init();
				}
			}),
			mxUtils.bind(this, function(errMsg, err)
			{
				//TODO Currently ignored, maybe we should retry?
			}));
		});

		var readData = mxUtils.bind(this, function (data)
		{
			// VSDX and PDF files are imported instead of being opened
			if (isVsdx)
			{
				var name = fileEntry.name;

				this.importVisio(data, mxUtils.bind(this, function(xml)
				{
					var dot = name.lastIndexOf('.');
					
					if (dot >= 0)
					{
						name = name.substring(0, name.lastIndexOf('.')) + '.drawio';
					}
					else
					{
						name = name + '.drawio';
					}
					
					if (xml.substring(0, 10) == '<mxlibrary')
					{
						// Creates new temporary file if library is dropped in splash screen
						if (this.getCurrentFile() == null && urlParams['embed'] != '1')
						{
							this.openLocalFile(this.emptyDiagramXml, this.defaultFilename);
						}
					
						try
						{
							this.loadLibrary(new LocalLibrary(this, xml, name));
							this.showSidebar();
						}
						catch (e)
						{
							this.handleError(e, mxResources.get('errorLoadingFile'));
						}
						
						fn();
					}
					else
					{
						fn(null, xml, null, name, false);
					}

					checkDrafts();
				}), null, name);
				
				return;
			}
			else if (isMermaid)
			{
				// Mermaid files are converted to a diagram and opened as a new,
				// unsaved .drawio file (the Mermaid source is preserved on the
				// resulting group/image for re-editing). Mirrors the VSDX/PDF
				// import path. The --mermaid-image command-line flag opens the
				// file as a static SVG image instead of an editable diagram.
				var name = fileEntry.name;
				var dot = name.lastIndexOf('.');
				name = (dot >= 0 ? name.substring(0, dot) : name) + '.drawio';

				// The Mermaid bundle loads asynchronously during startup, so a
				// .mmd/.mermaid file passed on the command line can arrive before
				// it is ready — wait for it before parsing.
				this.whenScriptReady(EditorUi.isMermaidSupported, mxUtils.bind(this, function()
				{
					var onMermaid = mxUtils.bind(this, function(diagramXml)
					{
						fn(null, diagramXml, null, name, false);

						// Mermaid files carry no stored view, so the default scroll
						// can land at an arbitrary edge (e.g. the bottom of a tall
						// flowchart). Apply the standard fit-on-load once the diagram
						// is in place.
						var ui = this;
						window.setTimeout(function() { ui.fitInitialView(); }, 0);

						checkDrafts();
					});

					var onMermaidError = mxUtils.bind(this, function(e)
					{
						fnErr(e);
						checkDrafts();
					});

					if (mermaidImage)
					{
						this.parseMermaidImage(data, onMermaid, onMermaidError);
					}
					else
					{
						this.parseMermaidDiagram(data, null, mxUtils.bind(this, function(mermaidXml)
						{
							// normalize:true shifts the wrapped content so the group's
							// padded bounds start at (0,0) — i.e. the diagram is inset
							// from the page origin by groupPadding instead of sitting
							// flush at (0,0) with the padding spilling into negative space.
							onMermaid(mxMermaidToDrawio.wrapGroup(mermaidXml, data, null, {normalize: true}));
						}), onMermaidError);
					}
				}), mxUtils.bind(this, function()
				{
					fnErr(new Error(mxResources.get('serviceUnavailableOrBlocked')));
					checkDrafts();
				}));

				return;
			}
			else if (/\.pdf$/i.test(path))
			{
				// Opens PDFs with embedded XML in place as editable files
				// like PNG below (previously extracted to a new .drawio file)
				data = Editor.extractGraphModelFromPdf('data:application/pdf;base64,' + data);

				// Stops before the file is bound to the path as a save
				// would overwrite the PDF with an empty diagram
				if (data == null)
				{
					fnErr(new Error(mxResources.get('notADiagramFile')));
					checkDrafts();

					return;
				}
			}
			else if (isPng)
			{
				// Detecting png by extension. Would need https://github.com/mscdex/mmmagic
				// to do it by inspection
				data = this.extractGraphModelFromPng('data:image/png;base64,' + data);

				// Stops before the file is bound to the path as a save
				// would overwrite the image with an empty diagram
				if (data == null)
				{
					fnErr(new Error(mxResources.get('notADiagramFile')));
					checkDrafts();

					return;
				}
			}

			electron.request({action: 'fileStat', file: path}, mxUtils.bind(this, function(stat_p)
			{
				stat = stat_p;
				fn(fileEntry, data, stat, null, false);

				electron.request({action: 'isFileWritable', file: path}, mxUtils.bind(this, function(isWritable)
				{
					if (!isWritable)
					{
						var file = this.getCurrentFile();

						if (file != null && file.fileObject != null && file.fileObject.path == path)
						{
							file.setEditable(false);
							this.updateStatus(mxUtils.bind(this, function()
							{
								this.editor.setStatus('<div class="geStatusBox" title="' +
									mxUtils.htmlEntities(mxResources.get('readOnly')) + '">' +
									mxUtils.htmlEntities(mxResources.get('readOnly')) + '</div>');
							}));						
						}
					}
				}));

				checkDrafts();
			}), function(errMsg, err)
			{
				fnErr(err);
			});
		});
 
		electron.request({
			action: 'readFile',
			filename: path,
			encoding: encoding
		}, readData, function(errMsg, err)
		{
			fnErr(err);
			checkDrafts();
		});
	};

	// Disables temp files in Electron
	var LocalFileCtor = LocalFile;
	
	LocalFile = function(ui, data, title, temp)
	{
		LocalFileCtor.call(this, ui, data, title, false);
	};

	mxUtils.extend(LocalFile, LocalFileCtor);

	LocalFile.prototype.getLatestVersion = function(success, error)
	{
		if (this.fileObject == null)
		{
			if (error != null)
			{
				error({message: mxResources.get('fileNotFound')});
			}
		}
		else
		{
			this.ui.readGraphFile(mxUtils.bind(this, function(fileEntry, data, stat, name, isModified)
			{
				var file = new LocalFile(this.ui, data, '');
				file.stat = stat;
				file.setModified(isModified? true : false);
				success(file);
			}), error, this.fileObject.path, true);
		}
	};
	
	// Call save as for copy
	LocalFile.prototype.copyFile = function(success, error)
	{
		this.saveAs(this.ui.getCopyFilename(this), success, error);
	};

	// Best-effort recovery source: the on-disk .bkp backup (last good save before
	// the most recent overwrite). Returns a lossless prior-version candidate or
	// null. See EditorUi.getRecoveryData / DrawioFile.getRecoveryVersion.
	LocalFile.prototype.getRecoveryVersion = function(success, error)
	{
		if (this.fileObject == null || this.fileObject.path == null)
		{
			success(null);
			return;
		}

		electron.request({action: 'getBkpFile', fileObject: {path: this.fileObject.path}},
			mxUtils.bind(this, function(bkp)
			{
				if (bkp != null && bkp.data != null && this.ui.isFileDataLoadable(bkp.data))
				{
					success({type: 'backup',
						label: mxResources.get('restoreBackupCopy'),
						description: mxResources.get('recoveryVersionDesc'),
						data: bkp.data, date: bkp.modified, lossy: false});
				}
				else
				{
					success(null);
				}
			}), mxUtils.bind(this, function()
			{
				success(null);
			}));
	};
	
	/**
	 * Adds all listeners.
	 */
	LocalFile.prototype.getDescriptor = function()
	{
		return this.stat;
	};

	/**
	* Updates the descriptor of this file with the one from the given file.
	*/
	LocalFile.prototype.setDescriptor = function(stat)
	{
		this.stat = stat;
	};
	
	LocalFile.prototype.isPdfFile = function()
	{
		return this.fileObject != null && /\.pdf$/i.test(this.fileObject.name);
	};

	// Autosave for PDF files re-runs the full export pipeline on every
	// change, so it is off by default and opt-in via the autosave toggle
	LocalFile.prototype.isAutosave = function()
	{
		if (this.isPdfFile())
		{
			return !this.inConflictState && isPdfAutosaveEnabled();
		}

		return this.fileObject != null && DrawioFile.prototype.isAutosave.apply(this, arguments);
	};

	// Detaches PDF files from the global autosave option (see toggle below)
	LocalFile.prototype.isAutosaveOptional = function()
	{
		return this.fileObject != null && !this.isPdfFile();
	};

	var isPdfAutosaveEnabled = function()
	{
		return localStorage.getItem('.pdfAutosave') == '1';
	};

	var setPdfAutosaveEnabled = function(ui, value)
	{
		localStorage.setItem('.pdfAutosave', (value) ? '1' : '0');

		// Refreshes the autosave checkbox and menu item
		ui.editor.fireEvent(new mxEventObject('autosaveChanged'));

		var file = ui.getCurrentFile();

		if (value && file != null && file.isModified())
		{
			file.fileChanged();
		}
	};

	var isCurrentFilePdf = function(ui)
	{
		var file = ui.getCurrentFile();

		return file != null && file.constructor == LocalFile &&
			file.isPdfFile() && file.isEditable();
	};

	// Repurposes the autosave action to toggle PDF autosave for PDF files
	var origMenusInit = Menus.prototype.init;

	Menus.prototype.init = function()
	{
		origMenusInit.apply(this, arguments);

		var editorUi = this.editorUi;
		var action = editorUi.actions.get('autosave');

		action.funct = function()
		{
			if (isCurrentFilePdf(editorUi))
			{
				setPdfAutosaveEnabled(editorUi, !isPdfAutosaveEnabled());
			}
			else
			{
				editorUi.editor.setAutosave(!editorUi.editor.autosave);
			}
		};

		action.setSelectedCallback(function()
		{
			return action.isEnabled() && ((isCurrentFilePdf(editorUi)) ?
				isPdfAutosaveEnabled() : editorUi.editor.autosave);
		});
	};

	// Keeps the autosave menu item enabled for PDF files where
	// isAutosaveOptional is false
	var origUpdateActionStates = EditorUi.prototype.updateActionStates;

	EditorUi.prototype.updateActionStates = function()
	{
		origUpdateActionStates.apply(this, arguments);

		if (isCurrentFilePdf(this))
		{
			this.actions.get('autosave').setEnabled(true);
		}
	};

	// Adds the autosave option for PDF files to the diagram format panel
	// (the global autosave option is hidden via isAutosaveOptional)
	var diagramFormatPanelAddOptions = DiagramFormatPanel.prototype.addOptions;

	DiagramFormatPanel.prototype.addOptions = function(div)
	{
		div = diagramFormatPanelAddOptions.apply(this, arguments);

		var ui = this.editorUi;

		if (ui.editor.graph.isEnabled() && isCurrentFilePdf(ui))
		{
			div.appendChild(this.createOption(mxResources.get('autosave'), function()
			{
				return isPdfAutosaveEnabled();
			}, function(checked)
			{
				setPdfAutosaveEnabled(ui, checked);
			},
			{
				install: function(apply)
				{
					this.listener = function()
					{
						apply(isPdfAutosaveEnabled());
					};

					ui.editor.addListener('autosaveChanged', this.listener);
				},
				destroy: function()
				{
					ui.editor.removeListener(this.listener);
				}
			}));
		}

		return div;
	};
	
	LocalFile.prototype.getTitle = function()
	{
		return (this.fileObject != null) ? this.fileObject.name : this.title;
	};

	LocalFile.prototype.isRenamable = function()
	{
		return false;
	};
	
	var autoSaveEnabled = false;

	LocalFile.prototype.save = function(revision, success, error, unloading, overwrite, cancel)
	{
		if (!this.isEditable())
		{
			this.saveAs(this.title, success, error, cancel);
			return;
		}

		DrawioFile.prototype.save.apply(this, [revision, mxUtils.bind(this, function()
		{
			this.saveFile(revision, mxUtils.bind(this, function()
			{
				//Only for first save after auto save is enabled (excluding the save as [overwrite])
				if (autoSaveEnabled && !overwrite && EditorUi.enableDrafts)
				{
					this.removeDraft();
				}

				autoSaveEnabled = false;
				success.apply(this, arguments);
			}), error, unloading, overwrite, cancel);
		}), error, unloading, overwrite]);
	};

	LocalFile.prototype.isConflict = function(stat)
	{
		return stat != null && this.stat != null && stat.mtimeMs != this.stat.mtimeMs;
	};
	
	LocalFile.prototype.saveFile = async function(revision, success, error, unloading, overwrite, cancel)
	{
		//Safeguard in case saveFile is called from online code in the future
		if (typeof success !== 'function')
		{
			if (typeof unloading === 'function')
			{
				//Call error
				unloading({message: 'This is a bug, please report!'}); //Original draw.io function parameters are (title, revision, success, error, useCurrentData)
			}
			return;
		}
		
		if (!this.savingFile)
		{
			var fn = mxUtils.bind(this, function(fileSavedFn)
			{
				var doSave = mxUtils.bind(this, function(data, enc)
				{
					var savedData = this.data;
					
					// Makes sure no changes get lost while the file is saved
					this.setShadowModified(false);
					this.savingFile = true;
					
					var errorWrapper = mxUtils.bind(this, function(e)
					{
						this.savingFile = false;
						
						if (error != null)
						{
	        				error(e);
						}
					});

					this.unwatchedSaves = true; //Multiple saves doesn't call watch the same number, so use a boolean and check for changes
					
					electron.request({
						action: 'saveFile',
						fileObject: this.fileObject,
						defEnc: enc,
						data: data,
						origStat: this.stat,
						overwrite: overwrite
					}, mxUtils.bind(this, function(stat)
					{
						//No changes during the saving process?
						this.setModified(this.getShadowModified());
						this.savingFile = false;
						var lastDesc = this.stat;
						this.stat = stat;
						
						this.fileSaved(savedData, lastDesc, mxUtils.bind(this, function()
						{
							this.ui.watchFile(this);
							this.contentChanged();
							
							if (fileSavedFn != null)
							{
								fileSavedFn();
							}

							if (success != null)
							{
								success();
							}
						}), error);
					}), 
					mxUtils.bind(this, function(errMsg, err)
					{
						if (errMsg == 'empty data')
						{
							this.ui.handleError({message: mxResources.get('errorSavingFile')});
							errorWrapper();
						}
						else if (errMsg == 'conflict')
						{
							this.inConflictState = true;
							errorWrapper();
						}
						else
						{
							errorWrapper(err || errMsg);
						}
					}));
				});
	
				// Libraries always save their XML data: the PDF and PNG
				// branches below export the current diagram, which would
				// replace the library contents
				if (this instanceof LocalLibrary)
				{
					doSave(this.getData());
				}
				else if (this.isPdfFile())
				{
					var p = this.ui.getPdfFileProperties(this.ui.fileNode);

					this.ui.getEmbeddedPdf(function(data)
					{
						doSave(data, 'binary');
					}, error, p.notes);
				}
				else if (!/(\.png)$/i.test(this.fileObject.name))
				{
					doSave(this.getData());
				}
				else
				{
					var p = this.ui.getPngFileProperties(this.ui.fileNode);

					this.ui.getEmbeddedPng(function(data)
					{
						doSave(atob(data), 'binary');
					}, error, null, p.scale, p.border);
				}
			});
			
			try
			{
				if (this.fileObject == null)
				{
					var lastDir = localStorage.getItem('.lastSaveDir');
					var isLibrary = this instanceof LocalLibrary;
					var name = this.ui.normalizeFilename(this.getTitle(),
						(isLibrary) ? 'xml' : null);
					var ext = null;

					if (name != null)
					{
						var idx = name.lastIndexOf('.');

						if (idx > 0)
						{
							ext = name.substring(idx + 1);
						}
					}

					var path = await requestSync({
						action: 'showSaveDialog',
						defaultPath: (lastDir || (await requestSync('getDocumentsFolder'))) + '/' + name,
						filters: (isLibrary) ? this.ui.createLibraryFileSystemFilters() :
							this.ui.createFileSystemFilters(ext)
					});

					if (path != null)
					{
						localStorage.setItem('.lastSaveDir', await requestSync({action: 'dirname', path: path}));
						this.fileObject = new Object();
						this.fileObject.path = path;
						this.fileObject.name = path.replace(/^.*[\\\/]/, '');
						this.fileObject.type = 'utf-8';
						this.title = this.fileObject.name;
						this.addToRecent();
						fn(mxUtils.bind(this, function()
						{
							if (EditorUi.enableDrafts)
							{
								this.removeDraft(true);
							}
						}));

						// Updates format panel to show autosave option
						var editor = this.ui.editor;
						editor.setAutosave(editor.autosave);
					}
					else
					{
						this.ui.spinner.stop();

						if (cancel != null)
						{
							cancel();
						}
					}
				}
				else
				{
					fn();
				}
			}
			catch (e)
			{
				error(e);
			}
		}
		else if (cancel != null)
		{
			//Another save is already in progress (eg. autosave), this save request is dropped
			cancel();
		}
	};


	var origAddConflictStatus = LocalFile.prototype.addConflictStatus;

	LocalFile.prototype.addConflictStatus = function(message, fn, latestFile)
	{
		if (Editor.desktopAutoSync && this.ui.editor.autosave)
		{
			fn();
		}
		else
		{
			origAddConflictStatus.apply(this, arguments);
		}
	};

	LocalFile.prototype.addToRecent = function()
	{
		if (this.fileObject == null) return;

		var title = this.fileObject.path;
				
		if (title.length > 100)
		{
			title = '...' + title.substr(title.length - 97);
		}

		this.ui.addRecent({id: this.fileObject.path, title: title});
	};

	LocalFile.prototype.saveAs = async function(title, success, error, cancel)
	{
		try
		{
			var lastDir = (this.fileObject != null && this.fileObject.path != null) ?
				await requestSync({action: 'dirname', path: this.fileObject.path}) :
				localStorage.getItem('.lastSaveDir');
			var isLibrary = this instanceof LocalLibrary;
			var name = this.ui.normalizeFilename(this.getTitle(),
				(isLibrary) ? 'xml' : null);
			var ext = null;

			if (name != null)
			{
				var idx = name.lastIndexOf('.');

				if (idx > 0)
				{
					ext = name.substring(idx + 1);
				}
			}

			var path = await requestSync({
				action: 'showSaveDialog',
				defaultPath: (lastDir || (await requestSync('getDocumentsFolder'))) + '/' + name,
				filters: (isLibrary) ? this.ui.createLibraryFileSystemFilters() :
					this.ui.createFileSystemFilters(ext)
			});

			if (path != null)
			{
				localStorage.setItem('.lastSaveDir', await requestSync({action: 'dirname', path: path}));
				this.fileObject = new Object();
				this.fileObject.path = path;
				this.fileObject.name = path.replace(/^.*[\\\/]/, '');
				this.fileObject.type = 'utf-8';
				this.title = this.fileObject.name;
				this.addToRecent();
				this.setEditable(true); //In case original file is read only
				this.save(false, mxUtils.bind(this, function()
				{
					this.ui.watchFile(this);
					success();
				}), error, null, true);
			}
			else if (cancel != null)
			{
				cancel();
			}
		}
		catch (e)
		{
			error(e);
		}
	};

	// The web LocalLibrary.saveAs calls saveFile with the web signature
	// (title, revision, ...), which hits the signature safeguard in the
	// desktop saveFile above, so the desktop saveAs is used instead
	LocalLibrary.prototype.saveAs = LocalFile.prototype.saveAs;

	LocalFile.prototype.saveDraft = function(data)
	{
		// Save draft only if file is not saved (prevents creating draft file after actual file is saved)
		if (!this.isModified()) return;

		if (this.fileObject == null)
		{
			//Use indexed db for unsaved files
			DrawioFile.prototype.saveDraft.apply(this, arguments);
		}
		else
		{
			EditorUi.debug('LocalFile.saveDraft', [this],
				'fileObject', [this.fileObject]);
			
			electron.request({
				action: 'saveDraft',
				fileObject: this.fileObject,
				data: (data != null) ? data : this.ui.getFileData()
			}, mxUtils.bind(this, function(draftFileName)
			{
				this.fileObject.draftFileName = draftFileName;
			}), mxUtils.bind(this, function(msg, e)
			{
				//TODO Currently ignored, maybe we should retry?
			}));
		}
	};

	LocalFile.prototype.removeDraft = async function(ignoreFileObject)
	{
		try
		{
			if (ignoreFileObject || this.fileObject == null)
			{
				//Use indexed db for unsaved files
				DrawioFile.prototype.removeDraft.apply(this, arguments);
			}
			else if (this.fileObject.draftFileName != null)
			{
				EditorUi.debug('LocalFile.removeDraft', [this],
					'draftFileName', [this.fileObject.draftFileName]);
				
				await requestSync({action: 'deleteFile', file: this.fileObject.draftFileName});
			}
		}
		catch (e)
		{
			// ignore
		}
	};

	LocalLibrary.prototype.addToRecent = function()
	{
		// do nothing
	};
	
	/**
	 * Loads the given file handle as a local file.
	 */
	App.prototype.createFileSystemFilters = function(defaultExt)
	{
		var ext = [];
		
		for (var i = 0; i < this.editor.diagramFileTypes.length; i++)
		{
			var obj = {name: mxResources.get(this.editor.diagramFileTypes[i].description) +
				' (.' + this.editor.diagramFileTypes[i].extension + ')',
				extensions: [this.editor.diagramFileTypes[i].extension]};
			
			if (this.editor.diagramFileTypes[i].extension == defaultExt)
			{
				ext.splice(0, 0, obj);
			}
			else
			{
				ext.push(obj);
			}
		}

		return ext;
	};

	/**
	 * Returns the save dialog filters for library files.
	 */
	App.prototype.createLibraryFileSystemFilters = function()
	{
		var filters = [];

		for (var i = 0; i < this.editor.libraryFileTypes.length; i++)
		{
			filters.push({name: this.editor.libraryFileTypes[i].description,
				extensions: this.editor.libraryFileTypes[i].extensions});
		}

		return filters;
	};

	/**
	 * Loads the given file handle as a local file.
	 */
	App.prototype.saveFile = function(forceDialog, success, error, cancel)
	{
		var file = this.getCurrentFile();

		if (file != null)
		{
			if (!forceDialog && file.getTitle() != null)
			{
				file.save(true, mxUtils.bind(this, function()
				{
					if (EditorUi.enableDrafts)
					{
						file.removeDraft();
					}

					file.handleFileSuccess(true);

					if (success != null)
					{
						success();
					}
				}), mxUtils.bind(this, function(err)
				{
					file.handleFileError(err, true);

					if (error != null)
					{
						error(err);
					}
				}), null, null, cancel);
			}
			else
			{
				let oldFileObject = file.fileObject;

				file.saveAs(null, mxUtils.bind(this, function()
				{
					if (EditorUi.enableDrafts)
					{
						//Workaround to delete the correct draft as the file object is updated in place
						let curFileObject = file.fileObject;
						file.fileObject = oldFileObject;
						file.removeDraft();
						file.fileObject = curFileObject;
					}

					file.handleFileSuccess(true);

					if (success != null)
					{
						success();
					}
				}), mxUtils.bind(this, function(err)
				{
					file.handleFileError(err, true);

					if (error != null)
					{
						error(err);
					}
				}), cancel);
			}
		}
	};
	
	/**
	 * Translates this point by the given vector.
	 */
	App.prototype.saveLibrary = function(name, images, file, mode, noSpin, noReload, fn)
	{
		mode = (mode != null) ? mode : this.mode;
		noSpin = (noSpin != null) ? noSpin : false;
		noReload = (noReload != null) ? noReload : false;
		var xml = this.createLibraryDataFromImages(images);
		
		var error = mxUtils.bind(this, function(resp)
		{
			this.spinner.stop();
			
			if (fn != null)
			{
				fn();
			}
			
			// Null means cancel by user and is ignored
			if (resp != null)
			{
				this.handleError(resp, mxResources.get('errorSavingFile'));
			}
		});
	
		// Handles special case for local libraries
		if (file == null)
		{
			file = new LocalLibrary(this, xml, name);
		}
		
		if (noSpin || this.spinner.spin(document.body, mxResources.get('saving')))
		{
			file.setData(xml);
			
			var doSave = mxUtils.bind(this, function()
			{
				file.save(true, mxUtils.bind(this, function(resp)
				{
					this.spinner.stop();
					this.hideDialog(true);
					
					if (!noReload)
					{
						this.libraryLoaded(file, images)
					}
					
					if (fn != null)
					{
						fn();
					}
				}), error);
			});
			
			if (name != file.getTitle())
			{
				var oldHash = file.getHash();
				
				file.rename(name, mxUtils.bind(this, function(resp)
				{
					// Change hash in stored settings
					if (file.constructor != LocalLibrary && oldHash != file.getHash())
					{
						mxSettings.removeCustomLibrary(oldHash);
						mxSettings.addCustomLibrary(file.getHash());
					}
	
					// Workaround for library files changing hash so
					// the old library cannot be removed from the
					// sidebar using the updated file in libraryLoaded
					this.removeLibrarySidebar(oldHash);
	
					doSave();
				}), error)
			}
			else
			{
				doSave();
			}
		}
	};
	
	App.prototype.checkForUpdates = function()
	{
		electron.sendMessage('checkForUpdates');
	};
	
	App.prototype.toggleSpellCheck = function()
	{
		electron.sendMessage('toggleSpellCheck');
	};

	App.prototype.toggleStoreBkp = function()
	{
		electron.sendMessage('toggleStoreBkp');
	};
	
	App.prototype.toggleGoogleFonts = function()
	{
		electron.sendMessage('toggleGoogleFonts');
	};

	App.prototype.openDevTools = function()
	{
		electron.sendMessage('openDevTools');
	};
		
	App.prototype.desktopZoomIn = function()
	{
		electron.sendMessage('zoomIn');
	};

	App.prototype.desktopZoomOut = function()
	{
		electron.sendMessage('zoomOut');
	};

	App.prototype.desktopResetZoom = function()
	{
		electron.sendMessage('resetZoom');
	};

	/**
	 * Copies the given cells and XML to the clipboard as an embedded image.
	 */
	EditorUi.prototype.writeImageToClipboard = async function(dataUrl, w, h, type, success, error)
	{
		try
		{
			await requestSync({
				action: 'clipboardAction', 
				method: 'writeImage',
				data: {dataUrl: dataUrl, w: w, h: h}
			});

			if (success != null)
			{
				success();
			}
		}
		catch (e)
		{
			if (error != null)
			{
				error(e);
			}
		}
	};

	/**
	 * Updates action states depending on the selection.
	 */
	var editorUiUpdateActionStates = EditorUi.prototype.updateActionStates;
	EditorUi.prototype.updateActionStates = function()
	{
		editorUiUpdateActionStates.apply(this, arguments);

		var file = this.getCurrentFile();
		var syncEnabled = file != null && file.fileObject != null;
		this.actions.get('synchronize').setEnabled(syncEnabled);
	};
	
	EditorUi.prototype.saveLocalFile = function(data, filename, mimeType, base64Encoded, format, allowBrowser)
	{
		this.saveData(filename, format, data, mimeType, base64Encoded);
	};
	
	EditorUi.prototype.saveRequest = function(filename, format, fn, data, base64Encoded, mimeType)
	{
		var xhr = fn(filename, '1');
		
		if (xhr != null && this.spinner.spin(document.body, mxResources.get('saving')))
		{
			xhr.send(mxUtils.bind(this, function()
			{
				this.spinner.stop();
				
				if (xhr.getStatus() >= 200 && xhr.getStatus() <= 299)
				{
					this.saveData(filename, format, xhr.getText(), mimeType, true);
				}
				else
				{
					this.handleError({message: mxResources.get('errorSavingFile')});
				}
			}), mxUtils.bind(this, function(resp)
			{
				this.spinner.stop();
				this.handleError(resp);
			}));
		}
	};

	function mxElectronRequest(reqType, reqObj)
	{
		this.reqType = reqType;
		this.reqObj = reqObj;
	};

	//Extends mxXmlRequest
	mxUtils.extend(mxElectronRequest, mxXmlRequest);
	
	mxElectronRequest.prototype.send = function(callback, error)
	{
		electron.sendMessage(this.reqType, this.reqObj);
		
		electron.listenOnce(this.reqType + '-success', (data) => 
		{
			this.response = data;
			callback();
			electron.sendMessage(this.reqType + '-finalize');
		})

		electron.listenOnce(this.reqType + '-error', (err) => 
		{
			this.hasError = true;
			error(err);
			electron.sendMessage(this.reqType + '-finalize');
		})
	};
	
	mxElectronRequest.prototype.getStatus = function()
	{
		return this.hasError? 500 : 200; 
	}
	
	mxElectronRequest.prototype.getText = function()
	{
		return this.response;
	}
	
	// Direct export to pdf
	EditorUi.prototype.createDownloadRequest = function(filename, format, ignoreSelection, base64,
		transparent, currentPage, scale, border, grid, includeXml, pageRange, w, h, crop, margin,
		fit, sheetsAcross, sheetsDown, shadows, icons)
	{
		var params = this.downloadRequestBuilder(filename, format, ignoreSelection, base64,
			transparent, currentPage, scale, border, grid, includeXml, pageRange, w, h, crop,
			margin, fit, sheetsAcross, sheetsDown, shadows, icons);

		return new mxElectronRequest('export', params);
	};

	// Renders all pages to PDF with the diagram XML embedded via the local
	// export pipeline, mirroring getEmbeddedPng for PNG files. The optional
	// icons argument adds notes as sticky note annotations.
	EditorUi.prototype.getEmbeddedPdf = function(success, error, icons)
	{
		var req = this.createDownloadRequest(null, 'pdf', true, '0',
			null, false, null, null, false, true, null, null, null,
			null, null, null, null, null, null, icons);

		req.send(function()
		{
			try
			{
				var data = req.getText();

				// The main process replies with the raw PDF bytes
				if (typeof data !== 'string')
				{
					var bytes = (data instanceof ArrayBuffer) ? new Uint8Array(data) : data;
					var result = [];

					for (var i = 0; i < bytes.length; i += 65536)
					{
						result.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 65536)));
					}

					data = result.join('');
				}

				success(data);
			}
			catch (e)
			{
				if (error != null)
				{
					error(e);
				}
			}
		}, error);
	};
	
	var origSetAutosave = Editor.prototype.setAutosave;

	Editor.prototype.setAutosave = function(value)
	{
		autoSaveEnabled = value;
		return origSetAutosave.apply(this, arguments);
	}

	//Export Dialog Pdf case
	var origExportFile = ExportDialog.exportFile;
	
	ExportDialog.exportFile = function(editorUi, name, format, bg, s, b, dpi)
	{
		var graph = editorUi.editor.graph;
		
		if (format == 'xml' || format == 'svg')
		{
			return origExportFile.apply(this, arguments);
		}
		else
		{
			var data = editorUi.getFileData(true, null, null, null, null, true);
    		var bounds = graph.getGraphBounds();
			var w = Math.floor(bounds.width * s / graph.view.scale);
			var h = Math.floor(bounds.height * s / graph.view.scale);
			
			editorUi.hideDialog();
			
			if ((format == 'png' || format == 'jpg' || format == 'jpeg') &&
				editorUi.editor.isExportToCanvas())
			{
				if (format == 'png')
				{
					editorUi.exportImage(s, bg == null || bg == 'none', true,
				   		false, false, b, true, false, null, null, dpi);
				}
				else 
				{
					editorUi.exportImage(s, false, true, false,
						false, b, true, false, 'jpeg');
				}
			}
			else 
			{
				var extras = {globalVars: graph.getExportVariables()};
				
				if (Graph.translateDiagram)
				{
					extras.diagramLanguage = Graph.diagramLanguage;
				}

				editorUi.saveRequest(name, format,
					function(newTitle, base64)
					{
						return new mxElectronRequest('export', {
							format: format,
							xml: data,
							bg: (bg != null) ? bg : mxConstants.NONE,
							filename: (newTitle != null) ? newTitle : null,
							w: w,
							h: h,
							border: b,
							base64: (base64 || '0'),
							extras: JSON.stringify(extras),
							dpi: dpi > 0? dpi : null
						}); 
					});
			}
		}
	};
	
	EditorUi.prototype.saveData = async function(filename, format, data, mimeType, base64Encoded)
	{
		var resume = (this.spinner != null && this.spinner.pause != null) ? this.spinner.pause() : function() {};
		var file = this.getCurrentFile();
		// Defaults to the folder of the current file like saveAs [jgraph/drawio-desktop#2132]
		var lastDir = (file != null && file.fileObject != null && file.fileObject.path != null) ?
			await requestSync({action: 'dirname', path: file.fileObject.path}) :
			localStorage.getItem('.lastExpDir');
		
		// Spinner.stop is asynchronous so we must invoke save dialog asynchronously
		// to give the spinner some time to stop spinning
		window.setTimeout(mxUtils.bind(this, async function()
		{
			var dlgConfig = {
				action: 'showSaveDialog',
				defaultPath: (lastDir || (await requestSync('getDocumentsFolder'))) + '/' + filename
			};
			var filters = null;
			
			switch (format)
			{
				case 'xmlpng':
				case 'png':
					filters = [
				          { name: 'PNG Images', extensions: ['png'] }
				       ];
				break;
				case 'jpg':
				case 'jpeg':
					filters = [
				          { name: 'JPEG Images', extensions: ['jpg', 'jpeg'] }
				       ];
				break;
				case 'svg':
					filters = [
				          { name: 'SVG Images', extensions: ['svg'] }
				       ];
				break;
				case 'pdf':
					filters = [
				          { name: 'PDF Documents', extensions: ['pdf'] }
				       ];
				break;
				case 'vsdx':
					filters = [
				          { name: 'VSDX Documents', extensions: ['vsdx'] }
				       ];
				break;
				case 'html':
					filters = [
				          { name: 'HTML Documents', extensions: ['html'] }
				       ];
				break;
				case 'xml':
					filters = [
				          { name: 'XML Documents', extensions: ['xml'] }
				       ];
				break;
				case 'txt':
					filters = [
				          { name: 'Plain Text', extensions: ['txt'] }
				       ];
				break;
			};
			
			dlgConfig['filters'] = filters;
			//showSaveDialog
			var path = await requestSync(dlgConfig);

	        if (path != null)
	        {
	        	localStorage.setItem('.lastExpDir', await requestSync({action: 'dirname', path: path}));

	        	if (data == null || data.length == 0)
				{
					this.handleError({message: mxResources.get('errorSavingFile')});
				}
				else
				{
					resume();
					
					electron.request({
						action: 'writeFile',
						path: path,
						data: data,
						enc: (base64Encoded) ? 'base64' : 'utf-8'
					}, mxUtils.bind(this, function ()
				    {
						this.spinner.stop();
		        	}), mxUtils.bind(this, function (e)
				    {
						this.spinner.stop();
						this.handleError(e, mxResources.get('errorSavingFile'));
		        	}));
				}
			}
		}), 50);
	};

	EditorUi.prototype.addBeforeUnloadListener = function() {};
	
	EditorUi.prototype.loadDesktopLib = function(libPath, success, error)
	{
		this.readGraphFile(mxUtils.bind(this, function(fileEntry, data, stat)
		{
			try
			{
				// Must not load the library here: the caller (App.loadLibraries)
				// waits for all libraries and loads them in the stored order,
				// an immediate load here would insert them in the random order
				// in which the file reads complete
				success(new DesktopLibrary(this, data, fileEntry));
			}
			catch (e)
			{
				error(e);
			}
		}), error, libPath);
	};

	// Returns the filesystem path for URLs that point to local files
	// (file:// URLs, drive, UNC and absolute paths), null otherwise
	Editor.getLocalFilePath = function(url)
	{
		if (url != null && url.substring(0, 7) == 'file://')
		{
			var path = decodeURIComponent(url.substring(7).split(/[?#]/)[0]);

			// Removes leading slash before Windows drive letters (file:///C:/...)
			return (/^\/[a-zA-Z]:/.test(path)) ? path.substring(1) : path;
		}
		else if (url != null && /^([a-zA-Z]:[\\\/]|[\\\/])/.test(url))
		{
			return url;
		}

		return null;
	};

	// Reads URLs that point to local files via the main process so libraries
	// and templates configured with local paths or file:// URLs work in the
	// desktop app [jgraph/drawio-desktop#1278]
	var editorLoadUrl = Editor.prototype.loadUrl;

	Editor.prototype.loadUrl = function(url, success, error, forceBinary, retry, dataUriPrefix, noBinary, headers)
	{
		try
		{
			var filename = Editor.getLocalFilePath(url);

			if (filename == null)
			{
				editorLoadUrl.apply(this, arguments);
			}
			else
			{
				var binary = !noBinary && (forceBinary || /(\.png)($|\?)/i.test(url) ||
					/(\.jpe?g)($|\?)/i.test(url) || /(\.gif)($|\?)/i.test(url) ||
					/(\.pdf)($|\?)/i.test(url));

				electron.request({action: 'readFile', filename: filename,
					encoding: (binary) ? 'base64' : 'utf-8'}, function(data)
				{
					if (success != null)
					{
						if (binary)
						{
							data = ((dataUriPrefix != null) ? dataUriPrefix :
								'data:image/png;base64,') + data;
						}

						success(data);
					}
				}, function(msg)
				{
					if (error != null)
					{
						error({message: (msg != null) ? msg :
							mxResources.get('fileNotFound')});
					}
				});
			}
		}
		catch (e)
		{
			if (error != null)
			{
				error(e);
			}
		}
	};
})();
