# SLE — Oracle Cloud deployment

## Production addresses

- Frontend: https://sle-xi.vercel.app
- Backend: https://sle-audit.duckdns.org
- Oracle public IP: 129.225.120.100

## Backend installation

```bash
cd ~/SLE/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
cp .env.example .env
nano .env
chmod 600 .env
```

Never commit or share `.env`.

## systemd

```bash
sudo cp ~/SLE/deploy/oracle/sle.service /etc/systemd/system/sle.service
sudo systemctl daemon-reload
sudo systemctl enable --now sle
sudo systemctl status sle --no-pager
```

## Nginx

```bash
sudo cp ~/SLE/deploy/oracle/nginx-sle.conf /etc/nginx/sites-available/sle
sudo ln -sf /etc/nginx/sites-available/sle /etc/nginx/sites-enabled/sle
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d sle-audit.duckdns.org
sudo systemctl status certbot.timer --no-pager
```

## Firewall

Oracle Security List and Linux iptables must permit TCP 22, 80 and 443. Save Linux rules:

```bash
sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

## Updating the backend

```bash
cd ~/SLE
git pull
source backend/venv/bin/activate
pip install -r backend/requirements.txt
sudo systemctl restart sle
sudo journalctl -u sle -n 100 --no-pager
```

## Frontend deployment

Deploy the `frontend` directory to Vercel. `frontend/config.js` already points to the Oracle backend. After the first deployment, clear the old PWA service worker once or use a hard refresh.
