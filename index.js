const puppeteer = require('puppeteer');
const useProxy = require('puppeteer-page-proxy');
const axios = require('axios');
const faker = require('faker');
const fs = require('fs');

const proxiesList = require('./proxiesList.json');

const nikeRegionURL = 'https://www.nike.com/gb';
const smsGenConfig = {
    url: 'https://public.sms-gen.com',
    apiKey: 'nlpte6h7lSVfW6vDhhImtPy4coW490ni',
    country: 'GB',
    channels: [
        2,3,6,7
    ]
}

const userDeets = {
    emailAddress: 'alexisyeo44562@dnnklls.com',
    firstName: 'Jane',
    lastName: 'Doe',
    password: 'Password123',
    dateOfBirth: '12/05/1996'
};

const maxTries = 20;

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

const addNumber = async (page, browser) => {
    // get a new number
    const newNumber = await getNumber(page, browser, 2);
    return newNumber;
};

const getNumber = async (page, browser, channel) => {
    // if (channel === (smsGenConfig.channels[smsGenConfig.channels.length - 1] + 1)) {
    //     await browser.close();
    // }
    const currentChannel = smsGenConfig.channels[channel];
    console.log("getting number on channel ", currentChannel);
    if (currentChannel) {
        try {
            const response = await axios.get(smsGenConfig.url + "/v1/sms/number", {
                params: {
                    country: smsGenConfig.country,
                    service: 'nike',
                    channel: currentChannel.toString(),
                    apikey: smsGenConfig.apiKey
                }
            });
            // console.log(response);
            if (!response.data.number) {
                // alert(response.data.error); 
                console.log('Status ', response.data);
                await sleep(2000);
                await getNumber(page, browser, channel + 1);
                // debugger;
            } else {
                console.log('Success status ', [response.data.status, response.data]);
                await page.type('.phoneNumber', response.data.number.substring(2));
                await page.click('.sendCodeButton');
                await page.waitForTimeout(500);
                // get and update code
                await getCode(page, browser, response.data.id, maxTries);
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

const getCode = async (page, browser, numberId, count) => {
    if (count === 0) {
        console.log("Max attempts reached, please try again.")
        await browser.close();
        return
    } else {
        console.log(`getting code for id ${numberId}. Attempts left: ${count}`);
        try {
            const response = await axios.get(smsGenConfig.url + "/v1/sms/code", {
                params: {
                    id: numberId,
                    apikey: smsGenConfig.apiKey
                }
            }); 
            if (response.data.isError || (response.data.retry && !response.data.isError)) {
                console.log('Retrying: ', response.data); 
                await sleep(3000);
                await getCode(page, browser, numberId, count - 1);
                // debugger;
            } else {
                console.log('Success ', response.data);
                
                await page.type('input.code', response.data.sms);
                // save and close pop up 
                await page.click('.nike-unite-checkbox');
                await page.evaluate(() => document.querySelector('.nike-unite-submit-button').firstElementChild.click());

                // Return account details 
                console.log('Account creation success! ' + userDeets.emailAddress + ':' + userDeets.password);
                createdAccounts.push(userDeets.emailAddress + ':' + userDeets.password);
                await browser.close();
                return response;
            } 
        } catch (error) {
            console.log(error); 
        }
    }
};

const generateUser = async (user) => {
    user.firstName = faker.name.firstName();
    user.lastName = faker.name.lastName();
    user.password = faker.internet.password() + '1';
    user.emailAddress = (user.firstName + user.lastName + faker.random.number() + '@dnnklls.com').toLowerCase();
    console.log('generated new user ', user);

    return user;
}

const accountCreator = async () => {
    const proxy = proxiesList[Math.floor(Math.random() * proxiesList.length)];
    const browser = await puppeteer.launch({
        args: [
            '--disable-web-security'
        ],
        headless: false,
        devtools: true
    });

    const page = await browser.newPage();
    console.log('Using proxy: ', proxy);

    // await useProxy(page, proxy);
    await preparePageForTests(page);
    const newUser =  await generateUser(userDeets);

    // const proxyCheck = await useProxy.lookup(page);
    // console.log('ip address', proxyCheck.ip);

    await page.setViewport({
        width: 1080,
        height: 1080,
        deviceScaleFactor: 1,
    });
    await page.goto(`${nikeRegionURL}/register`);

    await page.waitForSelector('input[name=emailAddress]');
    await page.waitForTimeout(500);

    // Key in user details
    await page.focus('input[name=emailAddress]')
    await page.keyboard.type(newUser.emailAddress);
    await page.waitForTimeout(200);

    await page.focus('input[name=password]')
    await page.keyboard.type(newUser.password);
    await page.waitForTimeout(200);

    await page.focus('input[name=firstName]')
    await page.keyboard.type(newUser.firstName);
    await page.waitForTimeout(200);


    await page.focus('input[name=lastName]')
    await page.keyboard.type(newUser.lastName);
    await page.waitForTimeout(200);


    await page.focus('input[name=dateOfBirth]')
    await page.keyboard.type(newUser.dateOfBirth);
    await page.waitForTimeout(200);

    await page.evaluate(() => document.querySelector('ul[data-componentname="gender"]').firstElementChild.click());
    await page.waitForTimeout(200);

    // Submit sign up form
    await page.evaluate(() => document.querySelector('div.joinSubmit').firstElementChild.click());

    await page.waitForNavigation();
    console.log('New Page URL:', page.url());
    await page.goto(`${nikeRegionURL}/member/settings`);
    await page.waitForSelector('.account-form');
    await page.evaluate(() => document.querySelector('button[aria-label="Add Mobile Number"]').firstElementChild.click());
    await addNumber(page, browser); 
    return
};

(async () => {
    const queueAttempts = 5;
    const timeBetween = [46000, 60000, 73000, 51000];

    // for (i = 0; i < queueAttempts; i++) {
    //     console.log('Attempt #', i + 1);
    //     await accountCreator();
    //     if (i === 0) {
    //         console.log("Accounts created, saving into file.")
    //         var accountsList = JSON.stringify(createdAccounts);
    //         console.log(accountsList);
            
    //         fs.writeFile(`accounts_${Date.now()}.json`, accountsList, 'utf8', function (err) {
    //             if (err) {
    //                 console.log("An error occured while writing JSON Object to File.");
    //                 return console.log(err);
    //             }
            
    //             console.log("JSON file has been saved.");
    //         });
    //     }
    //     await sleep(timeBetween[Math.floor(Math.random() * timeBetween.length)]);
    // }
    while (queueAttempts - (createdAccounts.length)) {
        console.log('Attempting to create account');
        await accountCreator();
        await sleep(timeBetween[Math.floor(Math.random() * timeBetween.length)]);
        console.log("Accounts created: ", createdAccounts)
    }
    var accountsList = JSON.stringify(createdAccounts);
    console.log(accountsList);
    
    fs.writeFile(`accounts_${Date.now()}.json`, accountsList, 'utf8', function (err) {
        if (err) {
            console.log("An error occured while writing JSON Object to File.");
            return console.log(err);
        }
    
        console.log("JSON file has been saved.");
    });
})();