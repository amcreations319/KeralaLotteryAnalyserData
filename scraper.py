import os
import base64
import requests
import sys

def main():
    # Get the URL sent from the GitHub workflow trigger
    url = os.environ.get("TARGET_URL")
    gas_web_app_url = os.environ.get("GAS_WEB_APP_URL")

    if not url:
        print("Error: No TARGET_URL provided.")
        sys.exit(1)

    print(f"Fetching lottery from URL: {url}...")
    
    # Python downloads the PDF smoothly without SSL errors
    response = requests.get(url, timeout=30)
    
    if response.status_code != 200 or len(response.content) < 1000:
        print(f"Results not yet published for {url}.")
        return

    # Encode PDF binary data to Base64 string to send back to GAS
    pdf_base64 = base64.b64encode(response.content).decode('utf-8')

    payload = {
        "url": url,
        "pdfBase64": pdf_base64
    }

    print(f"Sending PDF back to Google Apps Script...")
    gas_response = requests.post(gas_web_app_url, json=payload, timeout=60)
    
    print(f"GAS Response Code: {gas_response.status_code}")
    print(f"GAS Response Body: {gas_response.text}")

if __name__ == "__main__":
    main()
