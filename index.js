require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();
const cors = require('cors'); 
const fs = require('fs');
const path = require('path');

const AWS = require('aws-sdk');


const s3 = new AWS.S3();
const BUCKET_NAME = '11186437bucket';
const COUNTER_KEY = 'text.json';

async function getPageCount() {
    try {
        const data = await s3.getObject({
            Bucket: BUCKET_NAME,
            Key: COUNTER_KEY
        }).promise();

        return parseInt(data.Body.toString('utf-8')) || 0;
    } catch (error) {
        console.error("Error fetching counter:", error);
        return 0;
    }
}

async function incrementPageCount() {
    const currentCount = await getPageCount();
    const newCount = currentCount + 1;

    console.log("Current page count:", currentCount);

    await s3.putObject({
        Bucket: BUCKET_NAME,
        Key: COUNTER_KEY,
        Body: newCount.toString()
    }).promise();

    return newCount;
}

app.get('/', async (req, res) => {
    try {
        const pageVisits = await incrementPageCount();
        let htmlContent = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
        htmlContent = htmlContent.replace("<!-- PAGE_VISITS_PLACEHOLDER -->", `Page Visits: ${pageVisits}`);
        res.send(htmlContent);
    } catch (error) {
        res.status(500).send('Internal Server Error');
        console.error(error);
    }
});

app.use(express.static('public'));
app.use(express.json());
app.use(cors()); 

// endpoint of getting artist and similar artist info and youtube videos
app.get('/artist/:name', async (req, res) => {
    const artistName = req.params.name;

    // artist name validation
    if (!artistName || /^[\W_]+$/.test(artistName)) {
        return res.status(400).json({ error: 'Invalid artist name provided.' });
    }

    try {
        const artistResponse = await axios.get(`http://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${artistName}&api_key=${process.env.LASTFM_KEY}&format=json`);
        const similarArtistsResponse = await axios.get(`http://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${artistName}&limit=2&api_key=${process.env.LASTFM_KEY}&format=json`);

        const allArtists = [artistName, ...similarArtistsResponse.data.similarartists.artist.map(artist => artist.name)];

        const youtubeResponses = [];
        for (const artist of allArtists) {
            try {
                const youtubeResponse = await axios.get(`https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${artist}&type=video&key=${process.env.YOUTUBE_KEY}`);
                youtubeResponses.push(youtubeResponse);
            } catch (youtubeError) {
                console.error(`Error fetching YouTube data for ${artist}:`, youtubeError.response ? youtubeError.response.data.error : youtubeError.message);
                if (youtubeError.response && youtubeError.response.status === 403) {
                    break;
                }
            }
        }

        res.json({
            artist: artistResponse.data.artist,
            similarArtists: similarArtistsResponse.data.similarartists,
            youtubeVideos: youtubeResponses.map(response => response.data.items[0])
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Unable to fetch artist details.' });
    }
});





// endpoint of getting concert and waether info
app.get('/concert/:artistName', async (req, res) => {
    const artistName = req.params.artistName;

    if (!artistName || /^[\W_]+$/.test(artistName)) {
        return res.status(400).json({ error: 'Invalid artist name provided.' });
    }

    try {
        const concertResponse = await axios.get(`https://app.ticketmaster.com/discovery/v2/events.json?size=5&keyword=${artistName}&apikey=${process.env.TICKETMASTER_KEY}`);
        
        const weatherResponses = await Promise.all(concertResponse.data._embedded.events.map(async event => {
            const eventDate = event.dates.start.localDate;
            let weatherData = null;
    
            if (event._embedded && event._embedded.venues) {
                const cityName = event._embedded.venues[0].city.name;
    
                try {
                    const forecastURL = `http://api.weatherapi.com/v1/forecast.json?key=${process.env.WEATHER_KEY}&q=${cityName}&dt=${eventDate}`;
                    
                    const forecastResponse = await axios.get(forecastURL);


                    if (forecastResponse.data && forecastResponse.data.forecast && forecastResponse.data.forecast.forecastday && forecastResponse.data.forecast.forecastday.length) {
                        weatherData = { forecast: forecastResponse.data.forecast, type: 'forecast' };
                    } else {
                        throw new Error('No forecast data available.');
                    }
                } catch (forecastError) {
                    try {
                        const currentWeatherResponse = await axios.get(`http://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_KEY}&q=${cityName}`);
                        

                        if (currentWeatherResponse.data) {
                            weatherData = { current: currentWeatherResponse.data.current, type: 'current' };
                        } else {
                            weatherData = null;
                        }
                    } catch (currentWeatherError) {
                        console.error("Error fetching current weather data for", cityName, currentWeatherError.message);  
                        weatherData = null;
                    }
                }
            }
            return weatherData;
        }));

        const combinedData = concertResponse.data._embedded.events.map((event, index) => {
            const cityName = event._embedded && event._embedded.venues 
                             ? event._embedded.venues[0].city.name 
                             : 'Unknown';
            const venueName = event._embedded && event._embedded.venues 
                             ? event._embedded.venues[0].name 
                             : 'Unknown';
            const address = event._embedded && event._embedded.venues 
                           ? event._embedded.venues[0].address.line1 
                           : 'Unknown';

            return {
                artist: artistName,
                eventName: event.name,
                status: event.dates.status.code,
                eventDate: event.dates.start.localDate,
                city: cityName,
                venueName: venueName,
                address: address,
                weatherForecast: weatherResponses[index]
            };
        });

        res.json(combinedData);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Unable to fetch artist details.' });
    }
});




app.listen(3000, () => {
    console.log('Server is running on port 3000');
});