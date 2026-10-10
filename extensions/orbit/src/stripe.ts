/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { workspaceRoot } from './config';
import { storeProjectSecrets } from './envVars';
import { Page, requestJson } from './page';

const API = 'https://api.stripe.com/v1';
const KEY = 'orbit.stripe.key';
const CURRENCIES = ['eur', 'usd', 'gbp', 'chf', 'cad'];

interface Product {
	id: string;
	name: string;
	description: string;
	image?: string;
	price?: { id: string; amount: number; currency: string; interval?: string };
	link?: string;
}

interface Payment {
	id: string;
	amount: number;
	currency: string;
	status: string;
	created: number;
	description: string;
}

function publicPrefix(root: string): string {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
		const deps = { ...pkg.dependencies, ...pkg.devDependencies };
		return 'next' in deps ? 'NEXT_PUBLIC_' : 'vite' in deps ? 'VITE_' : 'nuxt' in deps ? 'NUXT_PUBLIC_' : 'expo' in deps ? 'EXPO_PUBLIC_' : '@sveltejs/kit' in deps ? 'PUBLIC_' : '';
	} catch {
		return '';
	}
}

/** Stripe wants its bodies as forms, nested fields written `a[b][c]`. */
function form(fields: Record<string, string | number | undefined>): string {
	return Object.entries(fields).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

/**
 * Stripe: payments for the project. Orbit talks to Stripe's API with a secret key the user pastes
 * once; it is kept in the system keychain (SecretStorage) and written to `.env.local` for the
 * project's server code, never shown to the agent. A product, its price and a payment link are
 * created in one go; the agent is given identifiers and variable names to wire the checkout.
 * A test key (`sk_test_`) is what a project under construction wants: a live key is accepted, and
 * everything it would create is confirmed first.
 */
export class Stripe extends Page {

	private key: string | undefined;
	private account: { name: string; country: string; currency: string } | undefined;
	private balance: { available: number; pending: number; currency: string } | undefined;
	private products: Product[] | undefined;
	private payments: Payment[] | undefined;
	private working: string | undefined;
	private error: string | undefined;

	constructor(context: vscode.ExtensionContext, private readonly tellAgent: (message: string) => boolean) {
		super(context, 'stripe', 'Stripe', 'stripe.svg');
		this.disposables.push(vscode.commands.registerCommand('orbit.stripe.show', () => this.show()));
	}

	private call(method: string, route: string, fields?: Record<string, string | number | undefined>) {
		return requestJson(method, `${API}${route}`, { 'authorization': `Bearer ${this.key}`, 'content-type': 'application/x-www-form-urlencoded' }, fields ? form(fields) : undefined);
	}

	private live(): boolean {
		return /^(sk|rk)_live_/.test(this.key ?? '');
	}

	protected send(): void {
		const root = workspaceRoot();
		this.post({
			type: 'state',
			project: path.basename(root),
			connected: !!this.key,
			live: this.live(),
			account: this.account,
			balance: this.balance,
			products: this.products,
			payments: this.payments,
			working: this.working,
			error: this.error,
			currencies: CURRENCIES,
			prefix: publicPrefix(root),
		});
	}

	protected override async refresh(): Promise<void> {
		this.key ??= await this.context.secrets.get(KEY);
		this.send();
		if (!this.key) {
			return;
		}
		const [account, balance, products, links, payments] = await Promise.all([
			this.call('GET', '/account'),
			this.call('GET', '/balance'),
			this.call('GET', '/products?active=true&limit=30&expand[]=data.default_price'),
			this.call('GET', '/payment_links?active=true&limit=50&expand[]=data.line_items'),
			this.call('GET', '/payment_intents?limit=12'),
		]);
		if (balance.status === 401) {
			this.error = 'Stripe refuse cette clé (retirée ou incomplète). Connecte-toi à nouveau.';
			this.key = undefined;
			await this.context.secrets.delete(KEY);
			this.send();
			return;
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const json = (answer: { json: unknown }) => answer.json as any;
		this.error = balance.ok ? undefined : `Stripe ne répond pas : ${balance.error}`;
		if (account.ok) {
			this.account = { name: String(json(account).settings?.dashboard?.display_name ?? json(account).business_profile?.name ?? json(account).email ?? 'Compte Stripe'), country: String(json(account).country ?? ''), currency: String(json(account).default_currency ?? 'eur') };
		}
		if (balance.ok) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const sum = (list: any[]) => (Array.isArray(list) ? list : []).reduce((total, entry) => total + (Number(entry.amount) || 0), 0);
			this.balance = { available: sum(json(balance).available), pending: sum(json(balance).pending), currency: String(json(balance).available?.[0]?.currency ?? this.account?.currency ?? 'eur') };
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const linkOf = new Map<string, string>((Array.isArray(json(links)?.data) ? json(links).data : []).flatMap((l: any) => (l.line_items?.data ?? []).map((item: any) => [String(item.price?.id), String(l.url)] as [string, string])));
		if (products.ok && Array.isArray(json(products).data)) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			this.products = json(products).data.map((p: any) => {
				const price = p.default_price && typeof p.default_price === 'object' ? p.default_price : undefined;
				return {
					id: String(p.id),
					name: String(p.name),
					description: String(p.description ?? ''),
					image: typeof p.images?.[0] === 'string' ? p.images[0] : undefined,
					price: price ? { id: String(price.id), amount: Number(price.unit_amount) || 0, currency: String(price.currency), interval: price.recurring?.interval ? String(price.recurring.interval) : undefined } : undefined,
					link: price ? linkOf.get(String(price.id)) : undefined,
				};
			});
		}
		if (payments.ok && Array.isArray(json(payments).data)) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			this.payments = json(payments).data.map((p: any) => ({ id: String(p.id), amount: Number(p.amount) || 0, currency: String(p.currency), status: String(p.status), created: Number(p.created) * 1000, description: String(p.description ?? p.receipt_email ?? '') }));
		}
		this.send();
	}

	/** Real money is involved with a live key: nothing is created without a yes. */
	private async sure(what: string): Promise<boolean> {
		return !this.live() || await vscode.window.showWarningMessage(`${what} en mode réel ?`, { modal: true, detail: 'Tu utilises une clé réelle : ce qui est créé ici est visible par tes vrais clients et peut encaisser de vrais paiements.' }, 'Continuer') === 'Continuer';
	}

	/** `stripe_state`: mode, account, products with their prices and payment links, last payments. Never the key. */
	async agentState(): Promise<unknown> {
		await this.refresh();
		if (!this.key) {
			this.show();
			throw new Error('Orbit n\'est pas connecté à Stripe. La page Stripe vient de s\'ouvrir : demande à l\'utilisateur d\'y coller sa clé, puis réessaie.');
		}
		return { mode: this.live() ? 'réel' : 'test', account: this.account, balance: this.balance, products: this.products, payments: this.payments, error: this.error };
	}

	/** `stripe_create_product`: a product, its price and its payment link, once the user has said yes. */
	async agentCreate(name: string, price: number, currency: string, interval: string | undefined, description: string): Promise<unknown> {
		this.key ??= await this.context.secrets.get(KEY);
		if (!this.key) {
			this.show();
			throw new Error('Orbit n\'est pas connecté à Stripe. La page Stripe vient de s\'ouvrir : demande à l\'utilisateur d\'y coller sa clé, puis réessaie.');
		}
		const amount = Math.round(price * 100);
		if (!name.trim() || !Number.isFinite(amount) || amount < 50) {
			throw new Error('Il faut un nom et un prix d\'au moins 0,50 (price en unités, par exemple 9.9).');
		}
		if (!CURRENCIES.includes(currency)) {
			throw new Error(`Monnaie inconnue « ${currency} ». Monnaies : ${CURRENCIES.join(', ')}.`);
		}
		const recurring = interval === 'month' || interval === 'year' ? interval : undefined;
		const shown = `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}${recurring ? (recurring === 'month' ? ' par mois' : ' par an') : ''}`;
		const choice = await vscode.window.showWarningMessage('L\'agent veut créer un produit Stripe', { modal: true, detail: `« ${name.trim()} » à ${shown}, avec son lien de paiement.\nMode ${this.live() ? 'réel : visible par tes vrais clients, il peut encaisser de vrais paiements' : 'test : aucun vrai paiement'}.` }, 'Créer');
		if (choice !== 'Créer') {
			throw new Error('L\'utilisateur a refusé : rien n\'a été créé.');
		}
		const product = await this.call('POST', '/products', { name: name.trim(), description: description.trim() || undefined, 'default_price_data[currency]': currency, 'default_price_data[unit_amount]': amount, 'default_price_data[recurring][interval]': recurring });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const made = product.json as any;
		if (!product.ok || !made?.default_price) {
			throw new Error(`Stripe a refusé le produit : ${product.error ?? 'raison inconnue.'}`);
		}
		const link = await this.call('POST', '/payment_links', { 'line_items[0][price]': String(made.default_price), 'line_items[0][quantity]': 1 });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const url = (link.json as any)?.url;
		this.refresh();
		return { ok: true, product: String(made.id), price: String(made.default_price), paymentLink: typeof url === 'string' ? url : undefined, note: link.ok ? undefined : `Produit créé, mais pas son lien de paiement : ${link.error}` };
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected async onMessage(msg: any): Promise<void> {
		switch (msg.type) {
			case 'refresh':
				await this.refresh();
				break;
			case 'keysPage':
				vscode.env.openExternal(vscode.Uri.parse('https://dashboard.stripe.com/test/apikeys'));
				break;
			case 'connect': {
				const key = String(msg.key ?? '').trim();
				if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]{16,}$/.test(key)) {
					this.error = 'Ce n\'est pas une clé secrète Stripe : elle commence par « sk_test_ » (essais) ou « sk_live_ » (réel).';
					this.send();
					break;
				}
				this.key = key;
				const check = await this.call('GET', '/balance');
				if (!check.ok) {
					this.key = undefined;
					this.error = check.status === 401 ? 'Stripe refuse cette clé.' : `Stripe ne répond pas : ${check.error}`;
					this.send();
					break;
				}
				await this.context.secrets.store(KEY, key);
				const publishable = String(msg.publishable ?? '').trim();
				const values: Record<string, string> = { STRIPE_SECRET_KEY: key };
				if (/^pk_(test|live)_[A-Za-z0-9]{16,}$/.test(publishable)) {
					values[`${publicPrefix(workspaceRoot())}STRIPE_PUBLISHABLE_KEY`] = publishable;
				}
				const file = storeProjectSecrets(workspaceRoot(), values);
				this.error = undefined;
				this.post({ type: 'toast', text: `Compte relié : ${Object.keys(values).join(' et ')} dans ${file}` });
				await this.refresh();
				break;
			}
			case 'logout':
				if (await vscode.window.showWarningMessage('Se déconnecter de Stripe ?', { modal: true, detail: 'La clé est retirée d\'Orbit. Celle écrite dans .env.local reste là, pour que ton projet continue de marcher.' }, 'Me déconnecter')) {
					await this.context.secrets.delete(KEY);
					this.key = undefined;
					this.account = this.balance = this.products = this.payments = undefined;
					this.send();
				}
				break;
			case 'create': {
				const name = String(msg.name ?? '').trim();
				const amount = Math.round(Number(String(msg.amount ?? '').replace(',', '.')) * 100);
				const currency = CURRENCIES.includes(msg.currency) ? String(msg.currency) : 'eur';
				const interval = ['month', 'year'].includes(msg.interval) ? String(msg.interval) : undefined;
				if (!name || !Number.isFinite(amount) || amount < 50) {
					this.post({ type: 'toast', text: 'Il faut un nom et un prix d\'au moins 0,50.' });
					break;
				}
				if (!await this.sure(`Créer « ${name} »`)) {
					break;
				}
				this.working = 'Création du produit…';
				this.send();
				const product = await this.call('POST', '/products', { name, description: String(msg.description ?? '').trim() || undefined, 'default_price_data[currency]': currency, 'default_price_data[unit_amount]': amount, 'default_price_data[recurring][interval]': interval });
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const made = product.json as any;
				if (!product.ok || !made?.default_price) {
					this.working = undefined;
					this.error = `Stripe a refusé le produit : ${product.error ?? 'raison inconnue.'}`;
					this.send();
					break;
				}
				this.working = 'Création du lien de paiement…';
				this.send();
				const link = await this.call('POST', '/payment_links', { 'line_items[0][price]': String(made.default_price), 'line_items[0][quantity]': 1 });
				this.working = undefined;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const url = (link.json as any)?.url;
				this.error = link.ok ? undefined : `Produit créé, mais pas son lien de paiement : ${link.error}`;
				if (typeof url === 'string') {
					await vscode.env.clipboard.writeText(url);
					this.post({ type: 'toast', text: 'Produit créé. Lien de paiement copié.' });
				}
				await this.refresh();
				break;
			}
			case 'link': {
				const price = String(msg.price ?? '');
				if (!/^price_\w+$/.test(price) || !await this.sure('Créer un lien de paiement')) {
					break;
				}
				const link = await this.call('POST', '/payment_links', { 'line_items[0][price]': price, 'line_items[0][quantity]': 1 });
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const url = (link.json as any)?.url;
				if (typeof url === 'string') {
					await vscode.env.clipboard.writeText(url);
					this.post({ type: 'toast', text: 'Lien de paiement créé et copié.' });
				} else {
					this.post({ type: 'toast', text: `Stripe a refusé : ${link.error}` });
				}
				await this.refresh();
				break;
			}
			case 'copy':
				await vscode.env.clipboard.writeText(String(msg.text ?? ''));
				this.post({ type: 'toast', text: 'Copié' });
				break;
			case 'open':
				if (/^https:\/\//.test(String(msg.url))) {
					vscode.env.openExternal(vscode.Uri.parse(String(msg.url), true));
				}
				break;
			case 'dashboard':
				vscode.env.openExternal(vscode.Uri.parse(`https://dashboard.stripe.com/${this.live() ? '' : 'test/'}${typeof msg.page === 'string' && /^[\w/-]+$/.test(msg.page) ? msg.page : ''}`));
				break;
			case 'env':
				await vscode.commands.executeCommand('orbit.env.show');
				break;
			case 'agent': {
				const prefix = publicPrefix(workspaceRoot());
				const list = (this.products ?? []).filter(p => p.price).map(p => `- ${p.name} : produit ${p.id}, prix ${p.price?.id} (${(p.price?.amount ?? 0) / 100} ${p.price?.currency.toUpperCase()}${p.price?.interval ? ` par ${p.price.interval === 'month' ? 'mois' : 'an'}` : ''})${p.link ? `, lien de paiement ${p.link}` : ''}`).join('\n');
				const ask = String(msg.ask ?? '').trim();
				this.tellAgent([
					`Le projet est relié à Stripe, en mode ${this.live() ? 'réel' : 'essai'}.`,
					`Les clés sont dans .env.local : STRIPE_SECRET_KEY (serveur uniquement) et ${prefix}STRIPE_PUBLISHABLE_KEY si elle y est (ne lis pas ce fichier, utilise ces noms dans le code).`,
					list ? `Produits du compte :\n${list}` : 'Aucun produit pour l\'instant.',
					'',
					ask || 'Branche le paiement dans le projet avec Stripe Checkout : une route serveur qui crée la session de paiement à partir d\'un identifiant de prix, le bouton qui y mène, les pages de succès et d\'annulation, et le webhook qui confirme le paiement (avec vérification de la signature). La clé secrète ne doit jamais atteindre le navigateur.',
					this.live() ? '' : 'Pour essayer : la carte 4242 4242 4242 4242, une date future, n\'importe quel code.',
				].filter(Boolean).join('\n'));
				break;
			}
		}
	}
}
