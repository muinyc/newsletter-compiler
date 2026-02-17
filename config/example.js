module.exports = {
    listmonk: {
        // Listmonk API configuration
        // See: https://listmonk.app/docs/apis/campaigns/
        baseUrl: 'http://localhost:9000',
        username: 'api',
        password: 'your-api-token',

        // Default campaign settings
        campaign: {
            name: 'Newsletter Campaign',
            subject: 'Weekly Newsletter',
            prefix: '[Newsletter]',             // Prepended to subject line
            lists: [{ "id": 1 }],               // Subscriber list IDs
            from_email: 'newsletter@example.com',
            content_type: 'html',
            type: 'regular',
            messenger: 'email',
            template_id: 1,
            tags: ['newsletter']
        }
    },

    wordpress: {
        // WordPress REST API configuration
        // Requires an Application Password: Users > Profile > Application Passwords
        baseUrl: 'https://your-site.com',
        username: 'your-username',
        password: 'your-application-password',

        // Image upload settings
        images: {
            prefix: 'newsletter-',
            allowedTypes: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
            maxSizeBytes: 10 * 1024 * 1024      // 10 MB
        },

        // How content is stored in the ACF field:
        //   'markdown' - raw markdown (default, for client-side rendering)
        //   'html'     - converted and processed HTML
        contentFormat: 'markdown'
    },

    newsletter: {
        title: 'My Newsletter',

        // UTM tracking
        // External links get ?utm_source=<trafficSource> appended.
        // Links pointing to webUrlDomain are left alone.
        webUrlDomain: 'example.com',
        webUrlBase: 'https://example.com/newsletters/',
        trafficSource: 'newsletter',

        // Absolute path to a shared attachments folder. When set, image
        // references starting with "Attachments/" resolve against this
        // path instead of relative to the markdown file.
        attachmentsPath: ''
    }
};

// Getting started:
// 1. Copy this file:  cp config/example.js config/config.local.js
// 2. Edit config/config.local.js with your real credentials
// 3. config/config.local.js is gitignored, so your secrets stay local
//
// For multiple newsletters, create named configs:
//   cp config/example.js config/weekly.js
//   node compile-email.js letter.md templates/example.html --config config/weekly.js
