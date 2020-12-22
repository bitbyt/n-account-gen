const puppeteer = require('puppeteer');
const useProxy = require('puppeteer-page-proxy');
const axios = require('axios');
const faker = require('faker');
const fs = require('fs');

const config = require('./config.js');
const proxiesList = require('./proxiesList.json');

let createdAccounts = []

const sleep = m => new Promise(r => setTimeout(r, m));

// Prepare page to bypass Akamai bot detection: https://github.com/puppeteer/puppeteer/issues/2511, https://intoli.com/blog/not-possible-to-block-chrome-headless/
const preparePageForTests = async (page) => {
    // Pass the User-Agent Test.
    const userAgent = 'Mozilla/5.0 (X11; Linux x86_64)' +
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.39 Safari/537.36';
    await page.setUserAgent(userAgent);

    // Pass the Webdriver Test.
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });
    });

    // Pass the Chrome Test.
    await page.evaluateOnNewDocument(() => {
        // We can mock this in as much depth as we need for the test.
        window.navigator.chrome = {
            runtime: {},
            // etc.
        };
    });

    // Pass the Permissions Test.
    await page.evaluateOnNewDocument(() => {
        const originalQuery = window.navigator.permissions.query;
        return window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
    });

    // Pass the Plugins Length Test.
    await page.evaluateOnNewDocument(() => {
        // Overwrite the `plugins` property to use a custom getter.
        Object.defineProperty(navigator, 'plugins', {
            // This just needs to have `length > 0` for the current test,
            // but we could mock the plugins too if necessary.
            get: () => [1, 2, 3, 4, 5],
        });
    });

    // Pass the Languages Test.
    await page.evaluateOnNewDocument(() => {
        // Overwrite the `plugins` property to use a custom getter.
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
        });
    });
};

const addNumber = async (page, browser, user) => {
    // get a new number
    const newNumber = await getNumber(page, browser, user, 2);
    return newNumber;
};

const getNumber = async (page, browser, user, channel) => {
    const currentChannel = config.smsGenConfig.channels[channel];
    console.log("Getting number on channel ", currentChannel);
    if (currentChannel) {
        try {
            const response = await axios.get(config.smsGenConfig.url + "/v1/sms/number", {
                params: {
                    country: config.smsGenConfig.country,
                    service: 'nike',
                    channel: currentChannel.toString(),
                    apikey: config.smsGenConfig.apiKey
                }
            });
            if (!response.data.number) {
                console.log('Status ', response.data);
                await sleep(2000);
                await getNumber(page, browser, user, channel + 1);
                // debugger;
            } else {
                console.log('Success status ', [response.data.status, response.data]);
                await page.type('.phoneNumber', response.data.number.substring(config.substringNumber));
                await page.click('.sendCodeButton');
                await page.waitForTimeout(500);
                // get and update code
                await getCode(page, browser, user, response.data.id, config.smsGenConfig.maxCodeTries);
                return response;
            }
        } catch (error) {
            console.log(error);
        }
    } else {
        console.log("No channels available");
        await browser.close();
    }
};

const getCode = async (page, browser, user, numberId, count) => {
    if (count === 0) {
        console.log("Max attempts reached, please try again.")
        await browser.close();
        return
    } else {
        console.log(`getting code for id ${numberId}. Attempts left: ${count}`);
        try {
            const response = await axios.get(config.smsGenConfig.url + "/v1/sms/code", {
                params: {
                    id: numberId,
                    apikey: config.smsGenConfig.apiKey
                }
            });
            if (response.data.isError || (response.data.retry && !response.data.isError)) {
                console.log('Retrying: ', response.data);
                await sleep(3000);
                await getCode(page, browser, user, numberId, count - 1);
                // debugger;
            } else {
                console.log('Success ', response.data);

                await page.type('input.code', response.data.sms);
                // save and close pop up 
                await page.click('.nike-unite-checkbox');
                await page.evaluate(() => document.querySelector('.nike-unite-submit-button').firstElementChild.click());

                // Return account details 
                console.log('Account creation success! ' + user.emailAddress + ':' + user.password);
                createdAccounts.push(user.emailAddress + ':' + user.password);
                await browser.close();
                return response;
            }
        } catch (error) {
            console.log(error);
        }
    }
};

const generateUser = async () => {
    console.log('Generating new user...', "color: grey");
    let user = {};
    user.firstName = faker.name.firstName();
    user.lastName = faker.name.lastName();
    user.password = faker.internet.password() + '1';
    user.emailAddress = (user.firstName + user.lastName + faker.random.number() + '@dnnklls.com').toLowerCase();
    user.dateOfBirth = '12/05/1996';
    console.log('generated new user ', user);

    return user;
}

const accountCreator = async (user) => {
    const proxy = proxiesList[Math.floor(Math.random() * proxiesList.length)];
    const browser = await puppeteer.launch({
        args: [
            '--disable-web-security',
            `--proxy-server=${proxy}`
        ],
        headless: false,
        devtools: true
    });

    const page = await browser.newPage();
    console.log('Using proxy: ', proxy);

    // await useProxy(page, proxy);
    await preparePageForTests(page);

    // const proxyCheck = await useProxy.lookup(page);
    // console.log('ip address', proxyCheck.ip);

    await page.setViewport({
        width: 1080,
        height: 1080,
        deviceScaleFactor: 1,
    });
    await page.goto(`${config.nikeRegionURL}/register`);

    await page.waitForSelector('input[name=emailAddress]');
    await page.waitForTimeout(500);

    // Key in user details
    await page.focus('input[name=emailAddress]')
    await page.keyboard.type(user.emailAddress);
    await page.waitForTimeout(200);

    await page.focus('input[name=password]')
    await page.keyboard.type(user.password);
    await page.waitForTimeout(200);

    await page.focus('input[name=firstName]')
    await page.keyboard.type(user.firstName);
    await page.waitForTimeout(200);


    await page.focus('input[name=lastName]')
    await page.keyboard.type(user.lastName);
    await page.waitForTimeout(200);


    await page.focus('input[name=dateOfBirth]')
    await page.keyboard.type(user.dateOfBirth);
    await page.waitForTimeout(200);

    await page.evaluate(() => document.querySelector('ul[data-componentname="gender"]').firstElementChild.click());
    await page.waitForTimeout(200);

    // Submit sign up form
    await page.evaluate(() => document.querySelector('div.joinSubmit').firstElementChild.click());
    // await page.waitForSelector('#nike-unite-error-view .nike-unite-error-panel');

    await page.exposeFunction('puppeteerLogMutation', async () => {
        console.log('Account creation failed. IP has been blocked.');
        await browser.close();
        return
    });

    await page.evaluate(() => {
        const target = document.querySelector('#nike-unite-error-view');
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    puppeteerLogMutation();
                }
            }
        });
        observer.observe(target, { childList: true });
    });
    await page.setDefaultNavigationTimeout(60000);

    await page.waitForNavigation();
    console.log('New Page URL:', page.url());
    await page.goto(`${config.nikeRegionURL}/member/settings`);
    await page.waitForSelector('.account-form');
    await page.evaluate(() => document.querySelector('button[aria-label="Add Mobile Number"]').firstElementChild.click());
    await addNumber(page, browser, user);
    return
};

(async () => {
    const timeBetween = [46000, 60000, 73000, 51000];
    console.log('config  ', config)
    while (config.accountsToGenerate - (createdAccounts.length)) {
        const newUser = await generateUser();
        console.log('Attempting to create account for user ', newUser);
        await accountCreator(newUser);
        console.log("Accounts created: ", createdAccounts);
        if ((config.accountsToGenerate - (createdAccounts.length)) >= 0) {
            await sleep(timeBetween[Math.floor(Math.random() * timeBetween.length)]);
        }
    }
    if (createdAccounts) {
        var accountsList = JSON.stringify(createdAccounts);
        console.log(accountsList);

        fs.writeFile(`accounts_${Date.now()}.json`, accountsList, 'utf8', function (err) {
            if (err) {
                console.log("An error occured while writing JSON Object to File.");
                return console.log(err);
            }

            console.log("JSON file has been saved.");
        });
    } else {
        console.log("No accounts created, please try again.")
    }
})();