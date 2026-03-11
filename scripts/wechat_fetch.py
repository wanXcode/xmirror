#!/usr/bin/env python3
import sys
import re
import json
import html2text
from scrapling.fetchers import Fetcher


def fix_lazy_images(html_raw: str) -> str:
    return re.sub(
        r'<img([^>]*?)\sdata-src="([^"]+)"([^>]*?)>',
        lambda m: f'<img{m.group(1)} src="{m.group(2)}"{m.group(3)}>',
        html_raw,
    )


def extract_meta(page, selectors):
    for selector in selectors:
        els = page.css(selector)
        if els:
            txt = els[0].text.strip()
            if txt:
                return txt
    return ''


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: wechat_fetch.py <url> [max_chars]"}, ensure_ascii=False))
        sys.exit(1)

    url = sys.argv[1]
    max_chars = int(sys.argv[2]) if len(sys.argv) > 2 else 30000

    page = Fetcher(auto_match=False).get(
        url,
        headers={"Referer": "https://www.google.com/search?q=site"}
    )

    content_html = ''
    used_selector = ''
    for selector in ['div#js_content', 'div.rich_media_content', 'article', 'main']:
        els = page.css(selector)
        if els:
            html_raw = fix_lazy_images(els[0].html_content)
            if len(re.sub(r'<[^>]+>', '', html_raw).strip()) > 100:
                content_html = html_raw
                used_selector = selector
                break

    if not content_html:
        content_html = fix_lazy_images(page.html_content)
        used_selector = 'body(fallback)'

    h = html2text.HTML2Text()
    h.ignore_links = False
    h.ignore_images = False
    h.body_width = 0
    markdown = h.handle(content_html)
    markdown = re.sub(r'\n{3,}', '\n\n', markdown).strip()[:max_chars]

    image_urls = re.findall(r'!\[[^\]]*\]\((https?://[^)\s]+)\)', markdown)

    title = extract_meta(page, ['h1#activity-name', 'h1.rich_media_title', 'title'])
    author = extract_meta(page, ['#js_name', '.profile_nickname']) or '微信公众号'

    print(json.dumps({
        "title": title,
        "author": author,
        "markdown": markdown,
        "images": image_urls,
        "selector": used_selector,
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
