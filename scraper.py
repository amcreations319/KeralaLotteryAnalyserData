import os
import base64
import requests

SERIAL_FILE = "draw_serial.txt"
GAS_WEB_APP_URL = "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE"
PASSKEY = "YOUR_PASSKEY_HERE" # Put your script passkey here

def get_current_draw_serial():
    if os.path.exists(SERIAL_FILE):
        with open(SERIAL_FILE, "r") as f:
            return int(f.read().strip())
    return 75401

def save_current_draw_serial(serial):
    with open(SERIAL_FILE, "w") as f:
        f.write(str(serial))

def main():
    draw_serial = get_current_draw_serial()
    url = f"https://result.keralalotteries.com/viewlotisresult.php?drawserial={draw_serial}"
    
    print(f"Fetching draw serial {draw_serial}...")
    
    # Python downloads the PDF smoothly without SSL errors
    response = requests.get(url, timeout=30)
    
    if response.status_code != 200 or len(response.content) < 1000:
        print(f"Results not yet published for draw serial {draw_serial}.")
        return

    # Encode PDF binary data to Base64 string to send back to GAS
    pdf_base64 = base64.b64encode(response.content).decode('utf-8')

    payload = {
        "secretKey": PASSKEY,
        "drawSerial": draw_serial,
        "url": url,
        "pdfBase64": pdf_base64
    }

    print(f"Sending PDF back to Google Apps Script...")
    gas_response = requests.post(GAS_WEB_APP_URL, json=payload, timeout=60)
    
    print(f"GAS Response Code: {gas_response.status_code}")
    print(f"GAS Response Body: {gas_response.text}")

    if "Successfully processed" in gas_response.text:
        save_current_draw_serial(draw_serial + 1)
        print(f"Successfully processed draw {draw_serial} and incremented serial.")

if __name__ == "__main__":
    main()
