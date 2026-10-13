/**
 * Klipy GIF Plugin - search, pick, and send share links that render inline.
 */

module.exports = {
  onLoad: async (ctx) => {
    const API_KEY = 'Qn0Whvr0vXSySgxfQRr28Vnlv0hQVvMEfXL1hiBvCV7demCrrCdALvnI1aUU4QO4';
    const BASE_URL = 'https://api.klipy.com';
    const React = ctx.React;
    const { Link: LinkIcon } = ctx.lucide;

    let currentRoomId = null;
    let pickerContainer = null;
    const mediaCache = new Map();

    ctx.settings.define({
      apiKey: {
        type: 'string',
        label: 'Klipy API Key',
        description: 'Your Klipy API key from partner.klipy.com',
        default: API_KEY,
      },
      limit: {
        type: 'number',
        label: 'Results Limit',
        description: 'Number of GIFs to show in picker',
        default: 12,
      },
    });

    function getApiKey() {
      return ctx.settings.get('apiKey') || API_KEY;
    }

    function getShareUrl(gifData) {
      if (typeof gifData?.itemurl === 'string' && gifData.itemurl.startsWith('http')) {
        return gifData.itemurl;
      }

      if (typeof gifData?.slug === 'string' && gifData.slug) {
        return `https://klipy.com/gifs/${gifData.slug}`;
      }

      const title = String(gifData?.title ?? 'gif')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);

      if (title) {
        return `https://klipy.com/gifs/${title}`;
      }

      return null;
    }

    function getPreviewUrl(gifData) {
      const formats = gifData.media_formats;
      if (formats) {
        return (
          formats.nanogifpreview?.url ||
          formats.tinygifpreview?.url ||
          formats.gifpreview?.url ||
          formats.preview?.url ||
          formats.nanogif?.url ||
          formats.tinygif?.url ||
          formats.mediumgif?.url ||
          formats.gif?.url
        );
      }

      const file = gifData.file;
      if (file) {
        return (
          file.xs?.jpg?.url ||
          file.sm?.jpg?.url ||
          file.sm?.gif?.url ||
          file.md?.gif?.url ||
          file.hd?.gif?.url
        );
      }

      return null;
    }

    function parseKlipyLink(body) {
      const trimmed = String(body ?? '').trim();
      if (!trimmed) return null;

      const pageMatch = trimmed.match(/^https?:\/\/(?:www\.)?klipy\.com\/gifs\/([a-zA-Z0-9-]+)\/?$/i);
      if (pageMatch) {
        return {
          kind: 'page',
          slug: pageMatch[1],
          shareUrl: trimmed,
        };
      }

      const staticMatch = trimmed.match(
        /^https?:\/\/static\.klipy\.com\/.+\.(gif|webp|jpg|jpeg|png|mp4|webm)(\?.*)?$/i
      );
      if (staticMatch) {
        return {
          kind: 'static',
          mediaUrl: trimmed,
          shareUrl: trimmed,
          title: 'GIF',
        };
      }

      return null;
    }

    async function resolveKlipyMedia(link) {
      const cacheKey = link.shareUrl;
      if (mediaCache.has(cacheKey)) {
        return mediaCache.get(cacheKey);
      }

      if (link.kind === 'static') {
        const resolved = {
          title: link.title || 'GIF',
          mediaUrl: link.mediaUrl,
          shareUrl: link.shareUrl,
        };
        mediaCache.set(cacheKey, resolved);
        return resolved;
      }

      const apiKey = getApiKey();
      const itemsUrl = `${BASE_URL}/api/v1/${apiKey}/gifs/items?slugs=${encodeURIComponent(link.slug)}`;
      const itemsResponse = await fetch(itemsUrl);
      if (itemsResponse.ok) {
        const itemsData = await itemsResponse.json();
        const item = itemsData?.data?.data?.[0];
        const gif =
          item?.file?.md?.gif ||
          item?.file?.hd?.gif ||
          item?.file?.sm?.gif ||
          item?.media_formats?.mediumgif ||
          item?.media_formats?.gif;

        if (gif?.url) {
          const resolved = {
            title: item.title || link.slug,
            mediaUrl: gif.url,
            shareUrl: item.slug ? `https://klipy.com/gifs/${item.slug}` : link.shareUrl,
          };
          mediaCache.set(cacheKey, resolved);
          return resolved;
        }
      }

      const searchUrl = `${BASE_URL}/v2/search?${new URLSearchParams({
        key: apiKey,
        q: link.slug,
        limit: '1',
        media_filter: 'gif,mediumgif,tinygif',
      }).toString()}`;

      const searchResponse = await fetch(searchUrl);
      if (!searchResponse.ok) {
        throw new Error(`Klipy lookup failed: ${searchResponse.status}`);
      }

      const searchData = await searchResponse.json();
      const result = searchData?.results?.[0];
      const mediaUrl =
        result?.media_formats?.mediumgif?.url ||
        result?.media_formats?.gif?.url ||
        result?.media_formats?.tinygif?.url;

      if (!mediaUrl) {
        throw new Error('GIF not found');
      }

      const resolved = {
        title: result.title || link.slug,
        mediaUrl,
        shareUrl: getShareUrl(result) || link.shareUrl,
      };
      mediaCache.set(cacheKey, resolved);
      return resolved;
    }

    function KlipyEmbed({ link }) {
      const [media, setMedia] = React.useState(null);
      const [failed, setFailed] = React.useState(false);
      const [hovered, setHovered] = React.useState(false);

      React.useEffect(() => {
        let cancelled = false;

        resolveKlipyMedia(link)
          .then((resolved) => {
            if (!cancelled) setMedia(resolved);
          })
          .catch((error) => {
            ctx.error('Failed to resolve Klipy link:', error);
            if (!cancelled) setFailed(true);
          });

        return () => {
          cancelled = true;
        };
      }, [link.shareUrl]);

      if (failed) {
        return React.createElement(
          'a',
          {
            href: link.shareUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          link.shareUrl
        );
      }

      if (!media) {
        return React.createElement(
          'div',
          { style: { color: '#9ca3af', fontSize: '12px', padding: '4px 0' } },
          'Loading GIF...'
        );
      }

      return React.createElement(
        'div',
        {
          style: {
            position: 'relative',
            display: 'inline-block',
            maxWidth: 'min(420px, 100%)',
            marginTop: '4px',
          },
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
        },
        React.createElement('img', {
          src: media.mediaUrl,
          alt: media.title,
          title: media.title,
          loading: 'lazy',
          onError: () => setFailed(true),
          style: {
            display: 'block',
            maxWidth: '100%',
            borderRadius: '8px',
            background: '#1f1f1f',
          },
        }),
        React.createElement(
          'a',
          {
            href: media.shareUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
            title: 'Open on Klipy',
            'aria-label': 'Open on Klipy',
            onClick: (event) => event.stopPropagation(),
            style: {
              position: 'absolute',
              top: '8px',
              right: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              border: 'none',
              background: 'rgba(0, 0, 0, 0.62)',
              color: '#fff',
              textDecoration: 'none',
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? 'auto' : 'none',
              transition: 'opacity 0.15s ease',
              backdropFilter: 'blur(4px)',
            },
          },
          React.createElement(LinkIcon, { size: 14, color: '#fff', strokeWidth: 2, 'aria-hidden': true })
        )
      );
    }

    function getActiveRoomId() {
      if (currentRoomId) {
        return currentRoomId;
      }

      try {
        let pathname = window.location.pathname;
        if (window.location.hash) {
          const hashMatch = window.location.hash.match(/#(.+)/);
          if (hashMatch) {
            pathname = hashMatch[1];
          }
        }

        const patterns = [/^\/home\/([^/]+)/, /^\/direct\/([^/]+)/, /^\/[^/]+\/([^/]+)/];
        for (const pattern of patterns) {
          const match = pathname.match(pattern);
          if (match?.[1]) {
            const idOrAlias = decodeURIComponent(match[1]);
            const room = ctx.matrixClient?.getRoom?.(idOrAlias);
            return room?.roomId ?? idOrAlias;
          }
        }
      } catch (error) {
        ctx.warn('Failed to resolve active room from URL:', error);
      }

      return null;
    }

    function createPickerOverlay() {
      if (!pickerContainer) {
        pickerContainer = document.createElement('div');
        pickerContainer.id = 'klipy-gif-picker';
        pickerContainer.style.cssText = `
          position: fixed;
          bottom: 80px;
          right: 20px;
          width: min(500px, calc(100vw - 40px));
          max-height: 400px;
          background: #1e1e1e;
          border: 1px solid #444;
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          z-index: 9999;
          display: none;
          overflow: hidden;
        `;
        document.body.appendChild(pickerContainer);
      }
      return pickerContainer;
    }

    function buildResultsGrid(gifResults) {
      const grid = document.createElement('div');
      grid.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;';

      gifResults.slice(0, 12).forEach((gifData) => {
        const previewUrl = getPreviewUrl(gifData);
        const item = document.createElement('div');
        item.className = 'gif-item';
        item.style.cssText =
          'cursor: pointer; border: 2px solid transparent; border-radius: 4px; overflow: hidden; background: #333; transition: all 0.2s;';

        item.addEventListener('mouseenter', () => {
          item.style.borderColor = '#6366f1';
          item.style.transform = 'scale(1.05)';
        });
        item.addEventListener('mouseleave', () => {
          item.style.borderColor = 'transparent';
          item.style.transform = 'scale(1)';
        });
        item.addEventListener('click', async () => {
          try {
            const roomId = getActiveRoomId();
            if (!roomId) {
              setPickerBodyMessage(
                document.querySelector('.klipy-picker-body'),
                'Open a room before sending a GIF',
                '#f87171'
              );
              return;
            }
            currentRoomId = roomId;
            await sendGifToRoom(roomId, gifData);
            if (pickerContainer) pickerContainer.style.display = 'none';
          } catch (error) {
            ctx.error('Failed to send GIF:', error);
          }
        });

        if (previewUrl) {
          const image = document.createElement('img');
          image.src = previewUrl;
          image.alt = gifData.title || 'GIF';
          image.loading = 'lazy';
          image.style.cssText = 'width: 100%; height: 120px; object-fit: cover; display: block;';
          item.appendChild(image);
        } else {
          const placeholder = document.createElement('div');
          placeholder.style.cssText =
            'width: 100%; height: 120px; display: flex; align-items: center; justify-content: center; color: #888; font-size: 12px;';
          placeholder.textContent = 'No preview';
          item.appendChild(placeholder);
        }

        const caption = document.createElement('div');
        caption.style.cssText =
          'padding: 4px; font-size: 10px; color: #aaa; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
        caption.textContent = gifData.title || 'GIF';
        item.appendChild(caption);

        grid.appendChild(item);
      });

      return grid;
    }

    function setPickerBodyMessage(body, message, color = '#888') {
      body.replaceChildren();
      const el = document.createElement('div');
      el.style.cssText = `color: ${color}; text-align: center; padding: 24px; font-size: 13px;`;
      el.textContent = message;
      body.appendChild(el);
    }

    function openGifPicker(initialQuery = '', preloadedResults = null) {
      const container = createPickerOverlay();
      container.style.display = 'block';
      container.replaceChildren();

      const header = document.createElement('div');
      header.style.cssText =
        'padding: 12px; background: #2a2a2a; border-bottom: 1px solid #444; display: flex; gap: 8px; align-items: center;';

      const searchInput = document.createElement('input');
      searchInput.type = 'search';
      searchInput.placeholder = 'Search GIFs...';
      searchInput.value = initialQuery;
      searchInput.autocomplete = 'off';
      searchInput.style.cssText =
        'flex: 1; padding: 8px 12px; border-radius: 6px; border: 1px solid #444; background: #1a1a1a; color: #fff; font-size: 14px; outline: none;';

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.title = 'Close';
      closeButton.setAttribute('aria-label', 'Close GIF picker');
      closeButton.style.cssText =
        'background: transparent; border: none; color: #aaa; cursor: pointer; font-size: 20px; line-height: 1; padding: 4px;';
      closeButton.textContent = '×';
      closeButton.addEventListener('click', () => {
        container.style.display = 'none';
      });

      const body = document.createElement('div');
      body.className = 'klipy-picker-body';
      body.style.cssText = 'padding: 12px; max-height: 340px; overflow-y: auto; min-height: 140px;';

      let searchTimer = null;

      const runSearch = async () => {
        const query = searchInput.value.trim();
        if (!query) {
          setPickerBodyMessage(body, 'Search for a GIF to get started');
          return;
        }

        setPickerBodyMessage(body, 'Searching...', '#9ca3af');

        try {
          const results = await searchGifs(query);
          body.replaceChildren();

          if (!results) {
            setPickerBodyMessage(body, `No GIFs found for "${query}"`);
            return;
          }

          body.appendChild(buildResultsGrid(results));
        } catch (error) {
          ctx.error('GIF search error:', error);
          setPickerBodyMessage(body, error.message || 'Search failed', '#f87171');
        }
      };

      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (searchTimer) clearTimeout(searchTimer);
          runSearch();
        }
        if (event.key === 'Escape') {
          container.style.display = 'none';
        }
      });

      searchInput.addEventListener('input', () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(runSearch, 350);
      });

      header.appendChild(searchInput);
      header.appendChild(closeButton);
      container.appendChild(header);
      container.appendChild(body);

      window.setTimeout(() => searchInput.focus(), 0);

      if (preloadedResults) {
        body.replaceChildren();
        body.appendChild(buildResultsGrid(preloadedResults));
        return;
      }

      if (initialQuery.trim()) {
        runSearch();
      } else {
        setPickerBodyMessage(body, 'Search for a GIF to get started');
      }
    }

    async function searchGifs(query) {
      const apiKey = getApiKey();
      const limit = ctx.settings.get('limit') || 12;

      if (!query || query.trim() === '') {
        throw new Error('Search query cannot be empty');
      }

      const params = new URLSearchParams({
        key: apiKey,
        q: query.trim(),
        limit: String(limit),
        media_filter: 'gif,tinygif,mediumgif,nanogif,gifpreview,tinygifpreview,nanogifpreview',
      });

      const url = `${BASE_URL}/v2/search?${params.toString()}`;
      ctx.log(`Searching Klipy: "${query}"`);

      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Klipy API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      if (!data.results?.length) {
        return null;
      }

      return data.results;
    }

    async function sendGifToRoom(roomId, gifData) {
      if (!roomId) {
        throw new Error('No room selected');
      }

      if (!ctx.matrixClient) {
        throw new Error('Matrix client not initialized');
      }

      const shareUrl = getShareUrl(gifData);
      if (!shareUrl) {
        throw new Error('No Klipy share URL available for this GIF');
      }

      ctx.log(`Sending Klipy link: ${shareUrl}`);
      await ctx.matrixClient.sendMessage(roomId, {
        msgtype: 'm.text',
        body: shareUrl,
      });

      return true;
    }

    ctx.ui.registerRenderer('message', (msg, defaultRenderer) => {
      const textTypes = new Set(['m.text', 'm.notice', 'm.emote']);
      if (!textTypes.has(msg.msgtype)) {
        return defaultRenderer?.() ?? null;
      }

      const link = parseKlipyLink(msg.body);
      if (!link) {
        return defaultRenderer?.() ?? null;
      }

      return React.createElement(KlipyEmbed, { link });
    });

    ctx.messages.onBeforeSend((msg) => {
      if (msg.roomId) {
        currentRoomId = msg.roomId;
      }
    });

    ctx.matrix.on('Room.timeline', (event) => {
      const room = event.getRoomId?.() || event.event?.room_id;
      if (room) {
        currentRoomId = room;
      }
    });

    ctx.commands.register({
      name: 'gif',
      description: 'Search GIFs and send a Klipy share link',
      args: ['query'],
      run: async ({ query, roomId }) => {
        if (!query) {
          return 'Usage: /gif [search]\nExample: /gif happy cat';
        }

        try {
          const results = await searchGifs(query);
          if (!results) {
            return `No GIFs for "${query}"`;
          }

          if (!roomId) {
            roomId = getActiveRoomId();
            if (!roomId) {
              return 'Cannot determine room. Open a room first.';
            }
          }

          currentRoomId = roomId;
          openGifPicker(query, results);
          return null;
        } catch (error) {
          ctx.error('GIF search error:', error);
          return `Error: ${error.message}`;
        }
      },
    });

    ctx.ui.registerButton({
      id: 'klipy-gif-picker',
      location: 'text-composer-toolbar',
      label: 'GIF',
      icon: 'lucide:ImagePlay',
      position: {
        after: 'emoji-picker-button',
        group: 'klipy',
        order: 1,
      },
      onClick: () => {
        const roomId = getActiveRoomId();
        if (!roomId) {
          ctx.warn('Cannot open GIF picker: no active room');
          return;
        }
        currentRoomId = roomId;
        openGifPicker();
      },
    });
  },

  onUnload: async () => {
    document.getElementById('klipy-gif-picker')?.remove();
  },
};
