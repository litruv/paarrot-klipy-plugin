/**
 * Klipy GIF Plugin - search, pick, and send share links that render inline.
 */

module.exports = {
  onLoad: async (ctx) => {
    const API_KEY = 'Qn0Whvr0vXSySgxfQRr28Vnlv0hQVvMEfXL1hiBvCV7demCrrCdALvnI1aUU4QO4';
    const BASE_URL = 'https://api.klipy.com';
    const React = ctx.React;

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
            display: 'inline-block',
            maxWidth: 'min(420px, 100%)',
            marginTop: '4px',
          },
        },
        React.createElement('img', {
          src: media.mediaUrl,
          alt: media.title,
          title: media.title,
          loading: 'lazy',
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
            style: {
              display: 'inline-block',
              marginTop: '6px',
              fontSize: '12px',
              color: '#8b8bf9',
              textDecoration: 'none',
            },
          },
          media.shareUrl
        )
      );
    }

    function createPickerOverlay() {
      if (!pickerContainer) {
        pickerContainer = document.createElement('div');
        pickerContainer.id = 'klipy-gif-picker';
        pickerContainer.style.cssText = `
          position: fixed;
          bottom: 80px;
          right: 20px;
          width: 500px;
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

    function showPicker(gifResults, query) {
      const container = createPickerOverlay();
      container.style.display = 'block';
      container.replaceChildren();

      const header = document.createElement('div');
      header.style.cssText =
        'padding: 12px; background: #2a2a2a; border-bottom: 1px solid #444; display: flex; justify-content: space-between; align-items: center;';

      const title = document.createElement('div');
      title.style.cssText = 'font-weight: 600; color: #fff;';
      title.textContent = `GIFs for "${query}" (${gifResults.length})`;
      header.appendChild(title);

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.textContent = '×';
      closeButton.style.cssText =
        'background: transparent; border: none; color: #aaa; cursor: pointer; font-size: 20px;';
      closeButton.addEventListener('click', () => {
        container.style.display = 'none';
      });
      header.appendChild(closeButton);

      const grid = document.createElement('div');
      grid.style.cssText =
        'padding: 12px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; max-height: 340px; overflow-y: auto;';

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
          await sendGifToRoom(currentRoomId, gifData);
          container.style.display = 'none';
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

      container.appendChild(header);
      container.appendChild(grid);
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
            roomId = currentRoomId;
            if (!roomId && ctx.matrixClient) {
              const rooms = ctx.matrixClient.getRooms();
              if (rooms?.length) {
                roomId = rooms[rooms.length - 1].roomId;
                currentRoomId = roomId;
              }
            }
            if (!roomId) {
              return 'Cannot determine room. Send a message first.';
            }
          }

          currentRoomId = roomId;
          showPicker(results, query);
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
      icon: 'GIF',
      position: {
        after: 'emoji-picker-button',
        group: 'klipy',
        order: 1,
      },
      onClick: async () => {
        const query = window.prompt('Search GIFs');
        if (!query?.trim()) return;

        try {
          const results = await searchGifs(query.trim());
          if (!results) {
            window.alert(`No GIFs for "${query.trim()}"`);
            return;
          }
          if (!currentRoomId) {
            window.alert('Cannot determine room. Send a message first.');
            return;
          }
          showPicker(results, query.trim());
        } catch (error) {
          ctx.error('GIF picker error:', error);
          window.alert(`GIF search failed: ${error.message}`);
        }
      },
    });
  },

  onUnload: async () => {
    document.getElementById('klipy-gif-picker')?.remove();
  },
};
