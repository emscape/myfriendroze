# myfriendroze

A modern, responsive website for myfriendroze ceramics and succulents, built with Astro.

## 🌵 About

myfriendroze specializes in handcrafted ceramic planters and carefully curated succulents. This website showcases our products and tells the story of our passion for plants and pottery.

## 🚀 Tech Stack

- **Framework:** [Astro](https://astro.build/)
- **Styling:** CSS with custom properties and responsive design
- **Typography:** Noto Sans Display
- **Hosting:** Firebase Hosting
- **Deployment:** Automated with CI/CD scripts

## 📁 Project Structure

```
/
├── astro/                  # Main Astro application
│   ├── src/
│   │   ├── components/     # Reusable components
│   │   ├── layouts/        # Page layouts
│   │   ├── pages/          # Route pages
│   │   └── styles/         # Global styles
│   └── public/             # Static assets
├── dist/                   # Built files for deployment
├── deploy.js               # Automated deployment script
├── deploy.bat              # Windows deployment script
└── DEPLOYMENT.md           # Deployment documentation
```

## 🛠️ Development

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Getting Started

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd myfriendroze
   ```

2. **Install dependencies:**
   ```bash
   cd astro
   npm install
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

4. **Open your browser:**
   Visit `http://localhost:4321`

### Building for Production

```bash
cd astro
npm run build
```

## 🚀 Deployment

This project includes automated deployment scripts for Firebase Hosting.

### Quick Deploy

```bash
node deploy.js
```

For detailed deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).

## 📧 Newsletter Setup

The newsletter signup uses ConvertKit for professional email management:

1. **Create ConvertKit account** at [convertkit.com](https://convertkit.com)
2. **Get your API key:**
   - Go to Account Settings → API Keys
   - Copy your API Key
3. **Create a form:**
   - Go to Grow → Landing Pages & Forms
   - Create a new form and copy the Form ID
4. **Set up environment variables:**
   ```bash
   cp astro/.env.example astro/.env
   # Edit astro/.env with your ConvertKit credentials:
   CONVERTKIT_API_KEY=your_api_key_here
   CONVERTKIT_FORM_ID=your_form_id_here
   ```

## 🎨 Design Features

- **Responsive Design:** Mobile-first approach with breakpoints for tablet and desktop
- **Custom Color Scheme:** Warm, earthy tones reflecting the natural aesthetic
- **Typography:** Noto Sans Display for clean, modern readability
- **Interactive Elements:** Smooth animations and hover effects
- **Accessibility:** Semantic HTML and proper ARIA labels

## 📱 Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

The source code is available under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0): you may read, run and adapt it for noncommercial purposes, but commercial use requires prior written permission. The myfriendroze name, logos, images, product content and site copy are not covered by that license, and all rights to them are reserved. See [LICENSE](LICENSE) for details.

## 📞 Contact

For questions about this project, please contact the myfriendroze team.

---

Built with ❤️ for plant lovers everywhere 🌱
