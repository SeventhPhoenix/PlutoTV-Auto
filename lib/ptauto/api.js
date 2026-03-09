(function() {
	const axios = require('axios');
	const converter = require('xml-js');
	const utils = require('#lib/utils.js');

	const USERAGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15';
	const STREAM_HOST = [98, 111, 111, 116, 46, 112, 108, 117, 116, 111, 46, 116, 118].map((c) => String.fromCharCode(c)).join('');
	const CHANNEL_HOST = [115, 101, 114, 118, 105, 99, 101, 45, 99, 104, 97, 110, 110, 101, 108, 115, 46, 99, 108, 117, 115, 116, 101, 114, 115, 46, 112, 108, 117, 116, 111, 46, 116, 118].map((c) => String.fromCharCode(c)).join('');
	const HTTP_TIMEOUT_MS = 20000;
	const client = axios.create({ timeout: HTTP_TIMEOUT_MS });
	let bootData = null;
	let channelList = null;
	let categoryList = null;
	let timelineList = null;
	const asArray = (value) => (Array.isArray(value) ? value : []);

	const boot = async (region, clientID) => {
		const d = new Date;
		const clientTime = encodeURI(d.toISOString());

		const headers = {};
		if (region) headers['X-Forwarded-For'] = region;

		const resp = await client.get(`https://${STREAM_HOST}/v4/start?appName=web&appVersion=7.9.0-a9cca6b89aea4dc0998b92a51989d2adb9a9025d&deviceVersion=16.2.0&deviceModel=web&deviceMake=Chrome&deviceType=web&clientID=${clientID}&clientModelNumber=1.0.0&channelID=5a4d3a00ad95e4718ae8d8db&serverSideAds=true&constraints=&drmCapabilities=&blockingMode=&clientTime=${clientTime}`, {headers});

		bootData = resp.data;
		// fs.writeFileSync("/tmp/boot.json", JSON.stringify(bootData, null, " "));
		return bootData;
	}

	const channels = async (region) => {
		const jwt = bootData.sessionToken;

		const headers = {
			Authorization: `Bearer ${jwt}`
		};

		if (region) headers['X-Forwarded-For'] = region;

		const resp = await client.get(`https://${CHANNEL_HOST}/v2/guide/channels?channelIds=&offset=0&limit=1000&sort=number%3Aasc`, {headers});

		channelList = resp.data;
		// fs.writeFileSync("/tmp/channelsList.json", JSON.stringify(channelList, null, " "));
		return resp.data;
	}

	const categories = async (region) => {
		const jwt = bootData.sessionToken;

		const headers = {
			Authorization: `Bearer ${jwt}`
		};

		if (region) headers['X-Forwarded-For'] = region;
		const resp = await client.get(`https://${CHANNEL_HOST}/v2/guide/categories`, {
			headers
		});

		categoryList = resp.data;
		// fs.writeFileSync("/tmp/categoryList.json", JSON.stringify(categoryList, null, " "));
		return resp.data;
	}

	const timelines = async (region) => {
		const jwt = bootData.sessionToken;

		const headers = {
			Authorization: `Bearer ${jwt}`
		};

		if (region) headers['X-Forwarded-For'] = region;

		timelineList = { data: [] };
		for (let offset = -1; offset < 24; offset += 4) {
			const d = new Date;
			d.setHours(d.getHours() + offset);
			const channelIds = asArray(channelList?.data).map(c => c.id);
			const chunkSize = 30;
			const requests = [];
			for (let i = 0; i < channelIds.length; i += chunkSize) {
				const chunks = channelIds.slice(i, i + chunkSize);
				const clientTime = encodeURI(d.toISOString());
				requests.push(client.get(`https://${CHANNEL_HOST}/v2/guide/timelines?start=${clientTime}&duration=240&channelIds=${chunks.join('%2C')}`, {headers}));
			}
			const responses = await Promise.all(requests);
			for (const response of responses) {
				timelineList.data = timelineList.data.concat(asArray(response?.data?.data));
			}
		}
		// fs.writeFileSync("/tmp/timelineList.json", JSON.stringify(timelineList, null, " "));
		// process.exit(0);
		return timelineList;
	}

	const generateM3U8 = async (
		region,
		group,
		regionalize,
		excludeGroups,
		excludeChannels,
		chno,
		xTvgUrl,
		vlcopts,
		xff,
		pipeopts
	) => {
		let numChannels = 0;
		let m3u8 = "#EXTM3U\n\n";

		if (xTvgUrl) {
			m3u8 = `#EXTM3U x-tvg-url="${xTvgUrl}"\n\n`;
		}

		for (let i = 0; i < asArray(channelList?.data).length; i++) {
			const c = channelList.data[i];

			if (!c.categoryIDs) {
				console.log("WARN: channel has no category ids", c.id, c.name);
				continue;
			}

			const category = asArray(categoryList?.data).find(cat => cat.id === c.categoryIDs[0]);
			const categoryName = category?.name || 'Unknown';
			const catname = group === 'genre' ? categoryName : region;

			if (excludeGroups && new RegExp(excludeGroups).test(categoryName)) continue;
			if (excludeChannels && new RegExp(excludeChannels).test(c.name)) continue;

			const tvgChno = chno !== false ? chno : c.number;
			const id = c.id + (regionalize && region ? '-' + region : '');
			// old v1 -> let url = bootData.servers.stitcher + c.stitched.path + '?' + bootData.stitcherParams;
			let url = `${bootData.servers.stitcher}/v2${c.stitched.path}?${bootData.stitcherParams}&jwt=${bootData.sessionToken}&masterJWTPassthrough=true`;
			if (vlcopts) {
				if (xff) m3u8 += `#EXTVLCOPT:http-referrer=${xff}\n`;
				m3u8 += `#EXTVLCOPT:http-user-agent=${USERAGENT}\n`;
			} else if (pipeopts) {
				if (xff) url += `|x-forwarded-for="${xff}"`;
				url += `|http-user-agent="${USERAGENT}"`;
			}

			const logo = c?.images?.[0]?.url || '';
			m3u8 += `#EXTINF:-1 tvg-id="${id}" tvg-logo="${logo}" tvg-chno="${tvgChno}" group-title="${catname}", ${c.name}\n${url}\n\n`;

			if (chno !== false) chno++;
			numChannels++;
		}
		return { m3u8, numChannels };
	}

	const generateXMLTV = async (region, regionalize) => {
		const obj = {
			"_declaration": {
				"_attributes": {
					"version": "1.0",
					"encoding": "UTF-8"
				}
			},
			"_doctype": "tv SYSTEM \"xmltv.dtv\"",
			"tv": {
				"_attributes": {
					"source-info-name": "nobody,xmltv.net,nzxmltv.com"
				},
				"channel": [],
				"programme": []
			}
		};

		for (let i = 0; i < asArray(channelList?.data).length; i++) {
			const c = channelList.data[i];

			if (!c.categoryIDs) {
				console.log("WARN: channel has no category ids", c.id, c.name);
				continue;
			}

			const channel = {
				"_attributes": {
					"id": c.id + (regionalize && region ? '-' + region : '')
				},  
				"display-name": {
					"_text": c.name
				},  
				"lcn": {
					"_text": c.number
				},
				"icon": {
					"_attributes": {
						"src": utils.escapeHTML(c?.images?.[0]?.url || '')
					}
				}
			};
			obj.tv.channel.push(channel);
		}

		for (let i = 0; i < asArray(timelineList?.data).length; i++) {
			const t = timelineList.data[i];
			const tl = asArray(t?.timelines).sort((a, b) => a.start - b.start);
			for (let j = 0; j < tl.length; j++) {
				const entry = tl[j];
				const start = new Date(entry.start);
				const stop = new Date(entry.stop);
				const programme = {
					"_attributes": {
						"channel": t.channelId + (regionalize ? '-' + region : ''),
						"start": `${utils.getTimeStr(start)} +0000`,
						"stop": `${utils.getTimeStr(stop)} +0000`
					},
					"title": {
						"_text": entry?.title || ''
					},
					"desc": {
						"_text": entry?.episode?.description || ''
					},
					"icon": {
						"_attributes": {
							"src": utils.escapeHTML(entry?.episode?.series?.tile?.path || '')
						}
					}
				}
				obj.tv.programme.push(programme);
			}
		}

		return converter.json2xml(JSON.stringify(obj), {compact: true, ignoreComment: true, spaces: 4});
	}

	exports = module.exports = {
		boot,
		channels,
		categories,
		timelines,
		generateM3U8,
		generateXMLTV
	}
})();
