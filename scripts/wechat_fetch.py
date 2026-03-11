#!/usr/bin/env python3
import sys
import re
import json
import html2text
from bs4 import BeautifulSoup
from curl_cffi import requests


def fix_lazy_images(html_raw: str) -> str:
    html_raw = re.sub(
        r'<img([^>]*?)\sdata-src="([^"]+)"([^>]*?)>',
        lambda m: f'<img{m.group(1)} src="{m.group(2)}"{m.group(3)}>',
        html_raw,
    )
    return html_raw


def clean_node_html(node) -> str:
    html_raw = str(node)
    html_raw = fix_lazy_images(html_raw)
    html_raw = re.sub(r'<script[\s\S]*?</script>', '', html_raw, flags=re.I)
    html_raw = re.sub(r'<style[\s\S]*?</style>', '', html_raw, flags=re.I)
    html_raw = re.sub(r'<iframe[\s\S]*?</iframe>', '', html_raw, flags=re.I)
    return html_raw


def find_text(soup, selectors):
    for selector in selectors:
        node = soup.select_one(selector)
        if node:
            txt = node.get_text(' ', strip=True)
            if txt:
                return txt
    return ''


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: wechat_fetch.py <url> [max_chars]"}, ensure_ascii=False))
        sys.exit(1)

    url = sys.argv[1]
    max_chars = int(sys.argv[2]) if len(sys.argv) > 2 else 30000

    resp = requests.get(
        url,
        impersonate='chrome124',
        timeout=30,
        allow_redirects=True,
        headers={
            'Referer': 'https://www.google.com/search?q=site',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
    )
    resp.raise_for_status()

    html = resp.text
    soup = BeautifulSoup(html, 'lxml')

    title = find_text(soup, ['h1#activity-name', 'h1.rich_media_title', 'title'])
    author = find_text(soup, ['#js_name', '.profile_nickname']) or '微信公众号'

    content_node = None
    used_selector = ''
    for selector in ['div#js_content', 'div.rich_media_content', 'article', 'main']:
        node = soup.select_one(selector)
        if node:
            text_len = len(node.get_text(' ', strip=True))
            if text_len > 100:
                content_node = node
                used_selector = selector
                break

    if content_node is None:
        content_node = soup.body or soup
        used_selector = 'body(fallback)'

    html_raw = clean_node_html(content_node)

    h = html2text.HTML2Text()
    h.ignore_links = False
    h.ignore_images = False
    h.body_width = 0
    markdown = h.handle(html_raw)
    markdown = re.sub(r'\n{3,}', '\n\n', markdown).strip()[:max_chars]

    image_urls = re.findall(r'!\[[^\]]*\]\((https?://[^)\s]+)\)', markdown)

    print(json.dumps({
        'title': title,
        'author': author,
        'markdown': markdown,
        'images': image_urls,
        'selector': used_selector,
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
