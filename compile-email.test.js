const fs = require('fs');
const path = require('path');

const {
  parseFrontmatter,
  processCallouts,
  processHighlighting,
  processTrackingLinks,
  processUtmTracking,
  processUtmTrackingMarkdown,
  processImageLinks,
  processFullbleedImages,
  loadConfig,
} = require('./compile-email');


// --- parseFrontmatter ---

describe('parseFrontmatter', () => {
  test('parses valid YAML frontmatter', () => {
    const input = '---\nsubject: Hello\nissue: "5"\n---\nBody text';
    const result = parseFrontmatter(input);
    expect(result.frontmatter.subject).toBe('Hello');
    expect(result.frontmatter.issue).toBe('5');
    expect(result.content).toBe('Body text');
  });

  test('returns empty frontmatter when none present', () => {
    const input = 'Just some markdown content';
    const result = parseFrontmatter(input);
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe(input);
  });

  test('returns empty frontmatter when no closing delimiter', () => {
    const input = '---\nsubject: Hello\nNo closing delimiter';
    const result = parseFrontmatter(input);
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe(input);
  });

  test('handles frontmatter with lists', () => {
    const input = '---\ntags:\n  - one\n  - two\n---\nContent';
    const result = parseFrontmatter(input);
    expect(result.frontmatter.tags).toEqual(['one', 'two']);
  });

  test('handles empty frontmatter block', () => {
    const input = '---\n---\nContent';
    const result = parseFrontmatter(input);
    // Empty YAML parses to null, which gets defaulted to {}
    expect(result.frontmatter).toEqual({});
    // Content includes the frontmatter delimiters since closing --- is at position 0
    // (the parser requires \n--- pattern with at least one char before it)
    expect(result.content).toBe(input);
  });
});


// --- processCallouts ---

describe('processCallouts', () => {
  test('converts blockquote with Callout: prefix', () => {
    const input = '<blockquote>\n<p><strong>Callout:</strong> Important info</p>\n</blockquote>';
    expect(processCallouts(input)).toBe('<p class="callout">Important info</p>');
  });

  test('is case-insensitive', () => {
    const input = '<blockquote>\n<p><strong>CALLOUT:</strong> Loud info</p>\n</blockquote>';
    expect(processCallouts(input)).toBe('<p class="callout">Loud info</p>');
  });

  test('leaves regular blockquotes unchanged', () => {
    const input = '<blockquote>\n<p>Just a normal quote</p>\n</blockquote>';
    expect(processCallouts(input)).toBe(input);
  });
});


// --- processHighlighting ---

describe('processHighlighting', () => {
  test('converts ==text== to highlighted span', () => {
    const input = 'This is ==important== text';
    expect(processHighlighting(input)).toBe(
      'This is <span class="highlight">important</span> text'
    );
  });

  test('handles multiple highlights', () => {
    const input = '==one== and ==two==';
    const result = processHighlighting(input);
    expect(result).toContain('<span class="highlight">one</span>');
    expect(result).toContain('<span class="highlight">two</span>');
  });

  test('leaves text without == unchanged', () => {
    const input = 'No highlights here';
    expect(processHighlighting(input)).toBe(input);
  });
});


// --- processTrackingLinks ---

describe('processTrackingLinks', () => {
  test('adds @TrackLink to regular links', () => {
    const input = 'href="https://example.com"';
    expect(processTrackingLinks(input)).toBe('href="https://example.com@TrackLink"');
  });

  test('skips links that already have @TrackLink', () => {
    const input = 'href="https://example.com@TrackLink"';
    expect(processTrackingLinks(input)).toBe(input);
  });

  test('skips mailto links', () => {
    const input = 'href="mailto:test@example.com"';
    expect(processTrackingLinks(input)).toBe(input);
  });

  test('skips anchor links', () => {
    const input = 'href="#section"';
    expect(processTrackingLinks(input)).toBe(input);
  });

  test('skips Listmonk template variables', () => {
    const input = 'href="{{ UnsubscribeURL }}"';
    expect(processTrackingLinks(input)).toBe(input);
  });
});


// --- processUtmTracking ---

describe('processUtmTracking', () => {
  // Save and restore config state
  const origModule = require('./compile-email');

  test('adds utm_source to external links', () => {
    const input = 'href="https://external.com/page"';
    const result = processUtmTracking(input);
    expect(result).toBe('href="https://external.com/page?utm_source=newsletter"');
  });

  test('skips links to configured webUrlDomain', () => {
    const input = 'href="https://example.com/page"';
    const result = processUtmTracking(input);
    expect(result).toBe(input);
  });

  test('skips links that already have utm_source', () => {
    const input = 'href="https://external.com?utm_source=other"';
    expect(processUtmTracking(input)).toBe(input);
  });

  test('skips mailto links', () => {
    const input = 'href="mailto:test@example.com"';
    expect(processUtmTracking(input)).toBe(input);
  });

  test('skips relative URLs', () => {
    const input = 'href="/local/page"';
    expect(processUtmTracking(input)).toBe(input);
  });

  test('appends with & when URL already has query params', () => {
    const input = 'href="https://external.com/page?foo=bar"';
    const result = processUtmTracking(input);
    expect(result).toBe('href="https://external.com/page?foo=bar&utm_source=newsletter"');
  });
});


// --- processUtmTrackingMarkdown ---

describe('processUtmTrackingMarkdown', () => {
  test('adds utm_source to markdown links', () => {
    const input = '[Link](https://external.com/page)';
    const result = processUtmTrackingMarkdown(input);
    expect(result).toBe('[Link](https://external.com/page?utm_source=newsletter)');
  });

  test('skips internal domain links', () => {
    const input = '[Link](https://example.com/page)';
    expect(processUtmTrackingMarkdown(input)).toBe(input);
  });

  test('skips mailto in markdown', () => {
    const input = '[Email](mailto:test@example.com)';
    expect(processUtmTrackingMarkdown(input)).toBe(input);
  });
});


// --- processFullbleedImages ---

describe('processFullbleedImages', () => {
  test('adds fullbleed class to standalone images', async () => {
    const input = '<p><img src="photo.jpg" alt="A photo"></p>';
    const result = await processFullbleedImages(input);
    expect(result).toContain('class="fullbleed no-caption"');
  });

  test('handles image with caption', async () => {
    const input = '<p><img src="photo.jpg" alt="A photo">\n<em>Caption text</em></p>';
    const result = await processFullbleedImages(input);
    expect(result).toContain('class="fullbleed"');
    expect(result).toContain('<p class="caption">Caption text</p>');
  });

  test('does not modify linked images', async () => {
    const input = '<a href="https://example.com"><img src="photo.jpg" alt="Linked"></a>';
    const result = await processFullbleedImages(input);
    expect(result).toBe(input);
  });
});


// --- loadConfig ---

describe('loadConfig', () => {
  test('loads the example config without error', () => {
    const config = loadConfig(path.join(__dirname, 'config', 'example.js'));
    expect(config.listmonk).toBeDefined();
    expect(config.wordpress).toBeDefined();
    expect(config.newsletter).toBeDefined();
  });

  test('exits on nonexistent config file', () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    loadConfig('/nonexistent/config.js');
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });
});


// --- Integration: compileEmail ---

describe('compileEmail integration', () => {
  const { compileEmail } = require('./compile-email');

  test('compiles example newsletter to HTML', async () => {
    const mdFile = path.join(__dirname, 'examples', 'newsletter.md');
    const tplFile = path.join(__dirname, 'templates', 'example.html');
    const outFile = path.join(__dirname, 'test-output.html');

    try {
      const html = await compileEmail(mdFile, tplFile, outFile);
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('first issue');
      expect(html).toContain('class="fullbleed');
      expect(html).toContain('class="callout"');
      expect(html).toContain('class="highlight"');
      // UTM tracking on external links
      expect(html).toContain('utm_source=');
      // TrackLink on links
      expect(html).toContain('@TrackLink');
    } finally {
      if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
    }
  });
});
