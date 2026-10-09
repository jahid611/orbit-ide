/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();
	// @ts-ignore
	const { escape } = window.OrbitMarkdown;
	// @ts-ignore
	const { icon } = window.OrbitIcons;

	const LOGO = '<span class="wordmark"><img src="https://cdn.simpleicons.org/stripe/635bff" alt="" /><b>Stripe</b></span>';
	const LEAVE = '<svg viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6.5 2.5h-3v11h3M10.5 5l3 3-3 3M13 8H6.5"/></svg>';
	const OUT = '<svg viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6.5 3.5h-3v9h9v-3M9.5 2.5h4v4m0-4L7.5 8.5"/></svg>';
	const STATUS = /** @type {Record<string, [string, string]>} */ ({ succeeded: ['Réussi', 'ok'], processing: ['En cours', 'wait'], requires_payment_method: ['Incomplet', 'off'], requires_action: ['Action requise', 'wait'], requires_confirmation: ['À confirmer', 'wait'], requires_capture: ['À encaisser', 'wait'], canceled: ['Annulé', 'off'] });

	/** @type {any} */
	let data;
	const view = { creating: false };
	const drawn = /** @type {Record<string, string>} */ ({});

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `<header class="bar" id="bar"></header><main id="main"></main><div id="toast" class="toast" hidden></div>`;
	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

	function draw(/** @type {string} */ id, /** @type {string} */ html) {
		if (drawn[id] !== html) {
			drawn[id] = html;
			$(id).innerHTML = html;
		}
	}

	function toast(/** @type {string} */ text) {
		const t = $('toast');
		t.textContent = text;
		t.hidden = false;
		clearTimeout(t._timer);
		t._timer = setTimeout(() => { t.hidden = true; }, 3400);
	}

	const money = (/** @type {number} */ amount, /** @type {string} */ currency) => {
		try {
			return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
		} catch {
			return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
		}
	};

	function connect() {
		return `<div class="center"><div class="card login">
			<div class="mark">${LOGO}</div><h1>Relie Stripe à Orbit</h1>
			<p>Encaisse des paiements dans ton projet. Orbit garde ta clé dans le coffre de ton système et l'écrit dans .env.local pour ton code serveur : elle ne va ni dans le dépôt, ni chez l'agent.</p>
			<ol>
				<li><i>1</i><div><b>Ouvre tes clés d'API</b><span>Dans le mode essai de Stripe : aucun vrai paiement, idéal pour construire.</span></div><button data-act="keysPage" class="btn">${OUT}Ouvrir la page</button></li>
				<li><i>2</i><div><b>Colle la clé secrète</b><span>Elle commence par « sk_test_ ».</span><input id="key" type="password" spellcheck="false" autocomplete="off" placeholder="sk_test_…" /></div></li>
				<li><i>3</i><div><b>Et la clé publique <em>(facultatif)</em></b><span>Elle commence par « pk_test_ » : utile si ta page affiche un formulaire de carte.</span><input id="publishable" type="text" spellcheck="false" autocomplete="off" placeholder="pk_test_…" /></div></li>
			</ol>
			${data.error ? `<div class="error">${escape(data.error)}</div>` : ''}
			<button data-act="connect" class="btn primary wide">Relier mon compte</button>
			<p class="foot">Pas encore de compte ? <a data-open="https://dashboard.stripe.com/register">Créer un compte Stripe</a></p>
		</div></div>`;
	}

	function dashboard() {
		const b = data.balance;
		const products = data.products;
		const form = view.creating ? `<div class="card create"><h2>Nouveau produit</h2>
			<div class="formgrid">
				<label class="wide2">Nom<input id="newName" type="text" spellcheck="false" placeholder="Abonnement Pro" /></label>
				<label>Prix<input id="newAmount" type="text" inputmode="decimal" placeholder="19,90" /></label>
				<label>Devise<select id="newCurrency">${data.currencies.map((/** @type {string} */ c) => `<option value="${c}" ${c === (data.account?.currency ?? 'eur') ? 'selected' : ''}>${c.toUpperCase()}</option>`).join('')}</select></label>
				<label>Facturation<select id="newInterval"><option value="">Une seule fois</option><option value="month">Chaque mois</option><option value="year">Chaque année</option></select></label>
				<label class="wide3">Description <em>(facultatif)</em><input id="newDescription" type="text" spellcheck="false" /></label>
			</div>
			<div class="row"><button data-act="create" class="btn primary" ${data.working ? 'disabled' : ''}>Créer le produit et son lien de paiement</button><button data-act="cancel" class="btn">Annuler</button></div></div>` : '';
		return `<div class="wrap">
			<div class="head"><h1>${escape(data.account?.name ?? 'Stripe')}</h1>${data.live ? '<span class="mode live">Mode réel</span>' : '<span class="mode">Mode essai</span>'}<span class="spacer"></span>
				<button data-act="agent" class="btn primary"><span class="claude-mark"></span>Brancher le paiement dans le projet</button>
				<button data-dash="" class="btn">${OUT}Tableau de bord</button></div>
			${data.error ? `<div class="error">${escape(data.error)}</div>` : ''}
			${data.working ? `<div class="working">${icon('refresh')}<span>${escape(data.working)}</span></div>` : ''}
			<div class="stats">
				<div><span>Solde disponible</span><b>${b ? money(b.available, b.currency) : '…'}</b></div>
				<div><span>En attente</span><b>${b ? money(b.pending, b.currency) : '…'}</b></div>
				<div><span>Produits</span><b>${products ? products.length : '…'}</b></div>
				<div><span>Paiements récents</span><b>${data.payments ? data.payments.filter((/** @type {any} */ p) => p.status === 'succeeded').length : '…'}</b></div>
			</div>
			<section>
				<div class="sub"><h2>Catalogue de produits</h2><span class="spacer"></span><button data-act="new" class="btn primary small">${icon('plus')}Ajouter un produit</button></div>
				${form}
				${!products ? `<div class="none">${icon('refresh')} Lecture du catalogue…</div>` : products.length ? `<div class="card table">${products.map((/** @type {any} */ p) => `<div class="tr">
					<div class="thumb">${p.image ? `<img src="${escape(p.image)}" alt="" />` : escape(p.name.slice(0, 1))}</div>
					<div class="name"><b>${escape(p.name)}</b><span>${escape(p.description || p.id)}</span></div>
					<div class="price">${p.price ? `<b>${money(p.price.amount, p.price.currency)}</b>${p.price.interval ? `<span>par ${p.price.interval === 'month' ? 'mois' : 'an'}</span>` : ''}` : '<span>Sans prix</span>'}</div>
					<div class="acts">${p.link ? `<button data-copy="${escape(p.link)}" class="btn small">${icon('link')}Copier le lien</button><button data-open="${escape(p.link)}" class="iconbtn" title="Ouvrir la page de paiement">${OUT}</button>` : p.price ? `<button data-link="${escape(p.price.id)}" class="btn small">Créer un lien de paiement</button>` : ''}${p.price ? `<button data-copy="${escape(p.price.id)}" class="iconbtn" title="Copier l'identifiant du prix (${escape(p.price.id)})">${icon('code')}</button>` : ''}</div>
				</div>`).join('')}</div>` : `<div class="none"><b>Aucun produit</b><br/>Ajoute ce que tu vends : Orbit crée le produit, son prix et un lien de paiement prêt à partager.</div>`}
			</section>
			<section>
				<div class="sub"><h2>Paiements</h2><span class="spacer"></span><button data-dash="payments" class="btn small">Tout voir</button></div>
				${!data.payments ? '' : data.payments.length ? `<div class="card table">${data.payments.map((/** @type {any} */ p) => `<div class="tr pay"><b class="amount">${money(p.amount, p.currency)}</b><span class="badge ${(STATUS[p.status] ?? ['', 'off'])[1]}">${(STATUS[p.status] ?? [escape(p.status)])[0]}</span><span class="desc">${escape(p.description || p.id)}</span><span class="when">${new Date(p.created).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>`).join('')}</div>` : `<div class="none small">Aucun paiement pour l'instant.${data.live ? '' : ' En mode essai, la carte 4242 4242 4242 4242 passe toujours.'}</div>`}
			</section>
		</div>`;
	}

	function render() {
		if (!data) {
			return;
		}
		draw('bar', `<div class="brand">${LOGO}${data.connected ? `<i>/</i><span>${escape(data.project)}</span>` : ''}</div><span class="spacer"></span>
			${data.connected ? `<button data-act="env" class="btn small">Variables</button><button data-act="refresh" class="iconbtn" title="Actualiser">${icon('refresh')}</button><button data-act="logout" class="iconbtn" title="Se déconnecter de Stripe">${LEAVE}</button>` : ''}`);
		const typing = view.creating && document.activeElement?.closest('.create');
		if (!typing || !$('newName')) {
			draw('main', !data.connected ? connect() : dashboard());
		}
	}

	document.addEventListener('click', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const attr = (/** @type {string} */ name) => target.closest(`[${name}]`)?.getAttribute(name);
		if (target.closest('[disabled]')) {
			return;
		}
		const act = attr('data-act');
		if (attr('data-copy')) {
			vscode.postMessage({ type: 'copy', text: attr('data-copy') });
		} else if (attr('data-open')) {
			vscode.postMessage({ type: 'open', url: attr('data-open') });
		} else if (attr('data-link')) {
			vscode.postMessage({ type: 'link', price: attr('data-link') });
		} else if (target.closest('[data-dash]')) {
			vscode.postMessage({ type: 'dashboard', page: attr('data-dash') || undefined });
		} else if (act === 'connect') {
			vscode.postMessage({ type: 'connect', key: $('key').value, publishable: $('publishable').value });
		} else if (act === 'new' || act === 'cancel') {
			view.creating = act === 'new';
			drawn.main = '';
			render();
			$('newName')?.focus();
		} else if (act === 'create') {
			vscode.postMessage({ type: 'create', name: $('newName').value, amount: $('newAmount').value, currency: $('newCurrency').value, interval: $('newInterval').value, description: $('newDescription').value });
			view.creating = false;
			drawn.main = '';
		} else if (act) {
			vscode.postMessage({ type: act });
		}
	});
	document.addEventListener('keydown', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		if (e.key === 'Enter' && (target.id === 'key' || target.id === 'publishable')) {
			vscode.postMessage({ type: 'connect', key: $('key').value, publishable: $('publishable').value });
		}
	});
	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg?.type === 'state') {
			data = msg;
			render();
		} else if (msg?.type === 'toast') {
			toast(msg.text);
		}
	});
	vscode.postMessage({ type: 'ready' });
})();
