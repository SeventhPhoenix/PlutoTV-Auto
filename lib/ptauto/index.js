(function() {
	const fs = require('fs');
	const axios = require('axios');
	const utils = require('#lib/utils.js');
	const api = require('./api');
	const ondemand = require('./ondemand');

	const TVPASS_HEADER = '#EXTM3U x-tvg-url="https://tvpass.org/epg.xml"';
	const TVPASS_PLAYLIST_URL = 'https://tvpass.org/playlist/m3u';
	const THETVAPP_TOKEN_URL = 'https://thetvapp.to/token';
	const TV_LOGOS_US_HD_API_URL = 'https://api.github.com/repos/tv-logo/tv-logos/contents/countries/united-states/hd';
	const THETVAPP_COOKIE = 'XSRF-TOKEN=eyJpdiI6ImFJZUd0NXRVVFdvTm12dVM1Unh6SWc9PSIsInZhbHVlIjoiTnZTUDFCNEpENUtGUEN0TkNKUUxRTmNwREhpREVUdHdsWWNOaHEzaklxRWxhZE12WWFJa05HYjhrOGtGcDYvZHZtcDRNREdPNDhSNlo4RVFCQ1R5Qy82YjFGcUdTRm5rTU1iWm1Lb1c2R0FJWlpNeENNU0gvbFh2eXFUVWVxcjIiLCJtYWMiOiI1MmI2ODQyZjc1ZTk3YzRmZDQ0NTMxNzgwNTc1MzE2OGJiNzg5M2Y1ODdjNzZiNTFkZjMxODhkZDZiNTg1NzVkIiwidGFnIjoiIn0%3D; thetvapp_session=eyJpdiI6Imhhemt2TG9OM1VtWk9kNFFwLzU3SFE9PSIsInZhbHVlIjoiZUhHNTNrSk5oY1NRd3lUZUE1N3JsWnVRak5HU1VHajh4ODd0K1NGYzJpL1Z1RDVRdVZicm4zZFZGaUpUOVE3dkZqcHVlR0p0N05aMzJGQzdvanNXa1lZb1hxTGVYekJ4VytvN2VKY0ppKzV4eTcrR1hvek1RaE1JTnl6aXdSNFgiLCJtYWMiOiJlN2I2MDgxMjg4M2ZhNmYxYjBmMmI5YTM2Y2M2NTJiYzc3YWUwODczMTFhYWIwNjJmZjc4OWU2YzRjZTQ1YTZlIiwidGFnIjoiIn0%3D';
	const CHANNEL_NAME_SUFFIXES = [' US Eastern Feed', ' Eastern Feed', ' US East', ' (US)'];
	const NOISE_WORDS = new Set([
		'channel', 'network', 'east', 'eastern', 'feed', 'us', 'usa', 'america', 'north', 'hd', 'tv'
	]);
	const BROADCAST_NETWORKS = new Set(['abc', 'cbs', 'nbc', 'fox', 'cw', 'pbs']);

	const cleanChannelName = (name) => {
		let cleaned = name;
		for (const suffix of CHANNEL_NAME_SUFFIXES) cleaned = cleaned.replace(suffix, '');
		return cleaned.trim().toLowerCase();
	};

	const normalizeLogoLookupText = (value) => (
		String(value || '')
			.toLowerCase()
			.replace(/&/g, ' and ')
			.replace(/\+/g, ' plus ')
			.replace(/!/g, '')
			.replace(/[^a-z0-9]+/g, ' ')
			.trim()
	);

	const normalizeSlugForLookup = (value) => (
		String(value || '')
			.toLowerCase()
			.replace(/\.png$/i, '')
			.replace(/-hd-us$/, '')
			.replace(/-us$/, '')
			.replace(/-hd$/, '')
			.replace(/-/g, ' ')
			.trim()
	);

	const tokenizeForLookup = (value) => normalizeLogoLookupText(value)
		.split(/\s+/)
		.filter(Boolean)
		.filter(token => !NOISE_WORDS.has(token));

	const buildAliasKeys = (name) => {
		const aliases = new Set();
		const normalized = normalizeLogoLookupText(name);
		if (normalized) aliases.add(normalized);
		const plain = normalized.replace(/\s+/g, '');
		if (plain) aliases.add(plain);
		const withAmp = normalized.replace(/\band\b/g, '&');
		if (withAmp) aliases.add(withAmp);
		return aliases;
	};

	const createLogoMapFromOutputPlaylists = (outdir) => {
		const logoMap = new Map();
		const logoByIdMap = new Map();
		const files = fs.readdirSync(outdir).filter(file => /^ptauto_.*\.m3u8$/.test(file));

		for (const file of files) {
			const lines = fs.readFileSync(`${outdir}/${file}`, 'utf-8').split('\n');
			for (const line of lines) {
				if (!line.startsWith('#EXTINF:')) continue;
				const logoMatch = line.match(/tvg-logo="([^"]+)"/);
				if (!logoMatch) continue;
				const logo = logoMatch[1];
				const idMatch = line.match(/tvg-id="([^"]+)"/);
				if (idMatch && !logoByIdMap.has(idMatch[1])) logoByIdMap.set(idMatch[1], logo);
				const commaIdx = line.indexOf(',');
				if (commaIdx < 0) continue;
				const name = line.slice(commaIdx + 1).trim();
				if (!name) continue;
				const key = cleanChannelName(name);
				if (!logoMap.has(key)) logoMap.set(key, logo);
			}
		}

		return { logoMap, logoByIdMap };
	};

	const createLogoMatcherFromTvLogos = async () => {
		const logoMap = new Map();
		const logoByIdMap = new Map();
		const aliasMap = new Map();
		const res = await axios.get(TV_LOGOS_US_HD_API_URL);
		const files = Array.isArray(res.data) ? res.data : [];
		const logoEntries = [];

		for (const file of files) {
			if (!file || file.type !== 'file' || !file.name || !file.download_url) continue;
			if (!String(file.name).toLowerCase().endsWith('.png')) continue;
			const logoUrl = String(file.download_url).trim();
			if (!logoUrl) continue;
			const slug = normalizeSlugForLookup(file.name);
			if (!slug) continue;

			const aliasSet = buildAliasKeys(slug);
			const tokens = tokenizeForLookup(slug);
			if (tokens.length) {
				aliasSet.add(tokens.join(' '));
				aliasSet.add(tokens.join(''));
			}

			const entry = { slug, logoUrl, tokens, aliases: aliasSet };
			logoEntries.push(entry);

			for (const alias of aliasSet) {
				if (alias && !aliasMap.has(alias)) aliasMap.set(alias, logoUrl);
			}

			const slugKey = cleanChannelName(slug);
			if (slugKey && !logoMap.has(slugKey)) logoMap.set(slugKey, logoUrl);
		}

		const scoreLogoEntry = (channelName, channelId, entry) => {
			const normalizedChannel = normalizeLogoLookupText(stripSuffixes(channelName));
			const channelTokens = tokenizeForLookup(normalizedChannel);
			if (!channelTokens.length || !entry.tokens.length) return 0;

			const shared = entry.tokens.filter(token => channelTokens.includes(token)).length;
			if (!shared) return 0;

			const hasLocalCallsign = /\([A-Z]{3,5}(-TV\d?)?\)/.test(channelName);
			const startsWithBrand = normalizedChannel.startsWith(entry.tokens[0]);
			const overlapRatio = shared / Math.max(channelTokens.length, entry.tokens.length);
			const channelCoverage = shared / channelTokens.length;
			const entryCoverage = shared / entry.tokens.length;

			let score = overlapRatio * 50 + channelCoverage * 20 + entryCoverage * 30;
			if (startsWithBrand) score += 8;
			if (shared === entry.tokens.length) score += 10;
			if (hasLocalCallsign && entry.tokens.length === 1 && BROADCAST_NETWORKS.has(entry.tokens[0])) score += 12;
			if (entry.tokens.length === 1 && channelTokens.length > 2 && !hasLocalCallsign) score -= 18;
			if (channelId) {
				const normalizedId = normalizeLogoLookupText(channelId);
				if (normalizedId.includes(entry.tokens.join(' '))) score += 10;
			}
			return score;
		};

		const pickLogo = (channelName, channelId) => {
			const normalizedName = normalizeLogoLookupText(stripSuffixes(channelName));
			const compactName = normalizedName.replace(/\s+/g, '');
			const normalizedId = normalizeLogoLookupText(channelId || '');
			const compactId = normalizedId.replace(/\s+/g, '');

			const exactKeys = [normalizedName, compactName, normalizedId, compactId].filter(Boolean);
			for (const key of exactKeys) {
				const logo = aliasMap.get(key);
				if (logo) return logo;
			}

			let best = null;
			let secondBest = null;
			for (const entry of logoEntries) {
				const score = scoreLogoEntry(channelName, channelId, entry);
				if (!best || score > best.score) {
					secondBest = best;
					best = { score, logo: entry.logoUrl };
				} else if (!secondBest || score > secondBest.score) {
					secondBest = { score, logo: entry.logoUrl };
				}
			}

			if (!best) return null;
			if (best.score < 42) return null;
			if (secondBest && (best.score - secondBest.score) < 8) return null;
			return best.logo;
		};

		return { logoMap, logoByIdMap, pickLogo };
	};

	const withLogoIfMissing = (extinfLine, logoMap, logoByIdMap, pickLogo) => {
		if (!extinfLine.startsWith('#EXTINF:')) return extinfLine;
		const commaIdx = extinfLine.indexOf(',');
		if (commaIdx < 0) return extinfLine;
		const name = extinfLine.slice(commaIdx + 1).trim();
		const id = extinfLine.match(/tvg-id="([^"]+)"/)?.[1];
		const logo = (id ? logoByIdMap.get(id) : null)
			|| logoMap.get(cleanChannelName(name))
			|| (pickLogo ? pickLogo(name, id) : null);
		if (!logo) return extinfLine;
		if (extinfLine.includes('tvg-logo=""')) return extinfLine.replace('tvg-logo=""', `tvg-logo="${logo}"`);
		if (extinfLine.includes('tvg-logo="')) return extinfLine;
		return `${extinfLine.slice(0, commaIdx)} tvg-logo="${logo}"${extinfLine.slice(commaIdx)}`;
	};

	const stripSuffixes = (value) => {
		let out = value;
		for (const suffix of CHANNEL_NAME_SUFFIXES) out = out.replace(suffix, '');
		return out.trim();
	};

	const normalizePremiumExtinfLine = (line) => {
		if (!line.startsWith('#EXTINF:')) return line;

		let out = line.replace('group-title="Live"', 'group-title="Premium Channels"');
		out = out.replace(/tvg-name="([^"]*)"/, (_, tvgName) => `tvg-name="${stripSuffixes(tvgName)}"`);

		const commaIdx = out.indexOf(',');
		if (commaIdx < 0) return out;
		const title = out.slice(commaIdx + 1).trim();
		return `${out.slice(0, commaIdx)},${stripSuffixes(title)}`;
	};

	const generatePremiumPlaylist = async (outdir) => {
		let logoMap = new Map();
		let logoByIdMap = new Map();
		let pickLogo = null;
		try {
			const tvLogosMaps = await createLogoMatcherFromTvLogos();
			logoMap = tvLogosMaps.logoMap;
			logoByIdMap = tvLogosMaps.logoByIdMap;
			pickLogo = tvLogosMaps.pickLogo;
			console.log(`Loaded ${logoMap.size} tv-logos name matches`);
		} catch (ex) {
			console.warn('WARN: failed to load tv-logos from GitHub API, falling back to local playlists:', ex.message);
			const localMaps = createLogoMapFromOutputPlaylists(outdir);
			logoMap = localMaps.logoMap;
			logoByIdMap = localMaps.logoByIdMap;
		}

		const res = await axios.get(TVPASS_PLAYLIST_URL);
		const premiumChannels = res.data
			.split('\n')
			.filter(line => !line.startsWith(TVPASS_HEADER));

		for (let i = 0; i < premiumChannels.length; i++) {
			const line = premiumChannels[i];
			const url = line.includes('https://tvpass.org/') ? line : null;

			if (url) {
				const slug = url.split('/').at(-2)?.split('.')[0];
				if (!slug) continue;
				console.log(`Updating ${slug}`);
				const tokenRes = await axios.get(`${THETVAPP_TOKEN_URL}/${slug}`, {
					headers: { Cookie: THETVAPP_COOKIE }
				});
				const newUrl = tokenRes.data.url;
				premiumChannels[i] = line.replace(url, newUrl).trim();
			} else {
				const normalized = normalizePremiumExtinfLine(line).trim();
				premiumChannels[i] = withLogoIfMissing(normalized, logoMap, logoByIdMap, pickLogo);
			}
		}

		fs.writeFileSync(`${outdir}/premium.m3u8`, `${premiumChannels.join('\n')}\n`, 'utf-8');
	};

	const process = async (config) => {
		const regionalPlaylists = {};
		const regionalEpgs = {};

		const mapping = config.getMapping();
		const group = config.get('group');
		const regionalize = config.get('regionalize');
		const all = config.get('all');
		const outdir = config.get('outdir');
		const excludeGroups = config.get('excludeGroups');
		const excludeChannels = config.get('excludeChannels');
		const xTvgUrl = config.get('xTvgUrl');
		const vlcopts = config.get('vlcopts');
		const pipeopts = config.get('pipeopts');

		let chno = config.get('chno');
		if (chno !== false) chno = +chno;

		const getRegion = async (region) => {
			console.info("INFO: processing", region);
			try {
				const clientID = config.get('clientID');
				const xff = mapping[region];

				let fullTvgUrl = false;
				if (xTvgUrl) fullTvgUrl =xTvgUrl + (xTvgUrl.endsWith('/') ? `ptauto_${region}.xml` : '');

				console.log("getting boot data");
				const bootData = await api.boot(xff, clientID);
				console.log("getting channels");
				const channels = await api.channels(xff);
				console.log("getting categories");
				const categories = await api.categories(xff);
				console.log("getting timelines");
				const timelines = await api.timelines(xff);

				console.log("generating m3u8");
				const { m3u8, numChannels } = await api.generateM3U8(
					region,
					group,
					regionalize,
					excludeGroups,
					excludeChannels,
					chno,
					fullTvgUrl,
					vlcopts,
					xff,
					pipeopts
				);

				if (chno !== false) chno += numChannels;

				console.log("generating xmltv");
				const xmltv = await api.generateXMLTV(region, regionalize);
				fs.writeFileSync(`${outdir}/ptauto_${region}.m3u8`, m3u8, 'utf-8');
				fs.writeFileSync(`${outdir}/ptauto_${region}.xml`, xmltv, 'utf-8');

				regionalPlaylists[region] = m3u8;
				regionalEpgs[region] = xmltv;

				if (config.get('ondemand')) {
					await ondemand.onDemandCategories(config, region, bootData);

					console.log("generating ondemand m3u8");
					const res = await ondemand.generateM3U8(config, region, bootData);
					if (res?.m3u8) fs.writeFileSync(`${outdir}/ptauto_ondemand_${region}.m3u8`, res.m3u8, 'utf-8');
					const xmltv = await ondemand.generateXMLTV(config, region);
					if (xmltv) fs.writeFileSync(`${outdir}/ptauto_ondemand_${region}.xml`, xmltv, 'utf-8');
					console.log("completed");
				}
			} catch (ex) {
				console.error("ERROR: got exception", ex.message);
			}
		}

		for (const key of Object.keys(mapping)) await getRegion(key);

		if (all && Object.keys(mapping).length > 1) {
			let fullTvgUrl = false;
			if (xTvgUrl) fullTvgUrl = xTvgUrl + (xTvgUrl.endsWith('/') ? 'ptauto_all.xml' : '');
			const m3u8 = utils.mergeM3U8(regionalPlaylists, fullTvgUrl);
			const xmltv = utils.mergeXMLTV(regionalEpgs);
			fs.writeFileSync(`${outdir}/ptauto_all.m3u8`, m3u8, 'utf-8');
			fs.writeFileSync(`${outdir}/ptauto_all.xml`, xmltv, 'utf-8');
		}

		try {
			await generatePremiumPlaylist(outdir);
			console.log('premium.m3u8 generated');
		} catch (ex) {
			console.error('ERROR: failed to generate premium.m3u8', ex.message);
		}
	}

	exports = module.exports = {
		process
	}
})();
